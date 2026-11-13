// Motor: junta os coletores, mantém o estado em memória e monta o `Snapshot`.
// Nenhuma varredura periódica: só reage a eventos de arquivo (handlePath) e a leituras da API.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Limit, Snapshot, Tool, ToolUsage } from "../shared/types";
import type { ApiUsage, ApiWindow } from "./claudeApi";
import * as claude from "./claudeLocal";
import * as codex from "./codex";
import { projectExhaustion } from "./pace";
import { GONE_SECS, SessionTracker } from "./sessions";
import type { Store } from "./store";
import { TailState, fileMtimeSecs, firstLine, readNewLines } from "./util";

export const WEEK = 7 * 86_400;
export const FIVE_HOURS = 5 * 3600;
/** Tetos iniciais (tokens ponderados) da estimativa local; recalibrados quando o número exato chega. */
export const DEFAULT_CAP_5H = 6.0e6;
export const DEFAULT_CAP_7D = 8.0e7;
/** Leitura exata mais velha que isso (3 consultas sem resposta) deixa de valer. */
const EXACT_FRESH_SECS = 15 * 60;

export interface Caps {
  five: number;
  week: number;
  calibrated: boolean;
}

export interface ExactReading {
  five: ApiWindow | null;
  week: ApiWindow | null;
  readAt: number;
}

interface ClaudeFile {
  tail: TailState;
  title: string | null;
  cwd: string | null;
  seen: Map<string, [number, number]>;
}

interface CodexFile {
  tail: TailState;
  meta: codex.SessionMeta;
  tokens: number;
}

function exactLimit(w: ApiWindow, windowMinutes: number, readAt: number, now: number): Limit {
  const renewed = w.resetsAt != null && w.resetsAt <= now;
  return {
    usedPercent: renewed ? 0 : w.utilization,
    resetsAt: renewed ? null : w.resetsAt,
    windowMinutes,
    source: "exact",
    readAt,
    renewed,
    projectedExhaustAt: null,
  };
}

function estimatedLimit(sum: number, cap: number, windowMinutes: number, now: number): Limit {
  return {
    usedPercent: cap > 0 ? Math.max(0, Math.min(100, (sum / cap) * 100)) : 0,
    resetsAt: null,
    windowMinutes,
    source: "estimated",
    readAt: now,
    renewed: false,
    projectedExhaustAt: null,
  };
}

/** Número exato quando a leitura é recente; senão a estimativa a partir dos tokens locais. */
export function buildClaudeUsage(now: number, sum5: number, sum7: number, caps: Caps, exact: ExactReading | null): ToolUsage {
  const fresh = exact && now - exact.readAt <= EXACT_FRESH_SECS ? exact : null;
  const five = fresh?.five ? exactLimit(fresh.five, 300, fresh.readAt, now) : estimatedLimit(sum5, caps.five, 300, now);
  const week = fresh?.week ? exactLimit(fresh.week, 10080, fresh.readAt, now) : estimatedLimit(sum7, caps.week, 10080, now);
  return { tool: "claude", plan: null, fiveHour: five, weekly: week, calibrated: caps.calibrated };
}

/** Ajusta o teto para que `sum` corresponda ao % exato informado. Ignora leituras baixas demais (ruído). */
export function calibrate(sum: number, exactPct: number, current: number): number {
  return exactPct >= 3 && sum > 0 ? sum / (exactPct / 100) : current;
}

function listFiles(dir: string, depth: number, out: Array<[string, number]>): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (depth > 0) listFiles(p, depth - 1, out);
    } else if (e.name.endsWith(".jsonl")) {
      const m = fileMtimeSecs(p);
      if (m != null) out.push([p, m]);
    }
  }
}

export class Engine {
  private sessions = new SessionTracker();
  private codexFiles = new Map<string, CodexFile>();
  private codexLatest: codex.CodexSample | null = null;
  private claudeFiles = new Map<string, ClaudeFile>();
  private storedOffsets = new Map<string, number>();
  private minutes = new Map<number, [number, number]>();
  private dirtyMinutes = new Set<number>();
  private dirtyOffsets = new Set<string>();
  private exact: ExactReading | null = null;
  private exactError: string | null = null;
  private caps: Caps;
  private lastSample = new Map<string, [number, number, number]>(); // chave -> [ts, pct, readAt]
  private lastPrune = 0;

  constructor(
    private store: Store,
    readonly claudeRoot: string,
    readonly codexRoot: string,
    now: number,
  ) {
    for (const [m, w, t] of store.loadMinutes(Math.floor((now - WEEK) / 60))) this.minutes.set(m, [w, t]);
    for (const [p, o] of store.loadOffsets()) this.storedOffsets.set(p, o);
    this.caps = {
      five: Number(store.get("claude_cap_5h")) || DEFAULT_CAP_5H,
      week: Number(store.get("claude_cap_7d")) || DEFAULT_CAP_7D,
      calibrated: store.getBool("claude_cap_cal", false),
    };
  }

  /** Leitura inicial: Codex (arquivos mais recentes até achar um limite) e Claude (últimos 7 dias, a partir do offset salvo). */
  initialScan(now: number): void {
    const codexFiles: Array<[string, number]> = [];
    listFiles(this.codexRoot, 4, codexFiles);
    codexFiles.sort((a, b) => b[1] - a[1]);
    for (const [p, m] of codexFiles.slice(0, 60)) {
      if (now - m >= GONE_SECS && this.codexLatest) break;
      this.processCodex(p, now);
    }
    const claudeFiles: Array<[string, number]> = [];
    listFiles(this.claudeRoot, 4, claudeFiles);
    claudeFiles.sort((a, b) => a[1] - b[1]);
    for (const [p, m] of claudeFiles) if (now - m <= WEEK) this.processClaude(p, now);
    this.flush(now);
  }

  handlePath(path: string, now: number): void {
    const norm = path.replace(/\//g, "\\");
    const under = (root: string) => norm.toLowerCase().startsWith(root.replace(/\//g, "\\").toLowerCase());
    if (path.endsWith(".meta.json")) {
      const jl = path.replace(/\.meta\.json$/, ".jsonl");
      if (under(this.claudeRoot)) this.processClaude(jl, now);
    } else if (path.endsWith(".jsonl")) {
      if (under(this.codexRoot)) this.processCodex(path, now);
      else if (under(this.claudeRoot)) this.processClaude(path, now);
    }
  }

  private processCodex(path: string, now: number): void {
    const mtime = fileMtimeSecs(path) ?? now;
    let cf = this.codexFiles.get(path);
    if (!cf) {
      const meta = codex.parseSessionMeta(firstLine(path, 1 << 20) ?? "") ?? { id: null, cwd: null, isSubagent: false };
      cf = { tail: new TailState(), meta, tokens: 0 };
      this.codexFiles.set(path, cf);
    }
    let best: codex.CodexSample | null = null;
    let lastTokens: number | null = null;
    try {
      readNewLines(path, cf.tail, (line) => {
        const s = codex.parseLine(line);
        if (!s) return;
        if (s.totalTokens != null) lastTokens = s.totalTokens;
        if ((s.primary || s.secondary) && (!best || s.ts >= best.ts)) best = s;
      });
    } catch {
      /* arquivo sumiu ou está bloqueado: tenta no próximo evento */
    }
    if (lastTokens != null) cf.tokens = lastTokens;
    if (best && (!this.codexLatest || (best as codex.CodexSample).ts >= this.codexLatest.ts)) this.codexLatest = best;
    if (now - mtime < GONE_SECS) {
      this.sessions.touch({
        key: path,
        tool: "codex",
        kind: cf.meta.isSubagent ? "subagent" : "main",
        agentType: null,
        label: codex.labelFromCwd(cf.meta.cwd),
        activity: mtime,
        tokens: cf.tokens,
        finished: false,
      });
    }
  }

  private processClaude(path: string, now: number): void {
    const kind = claude.classifyPath(path, this.claudeRoot);
    if (!kind) return;
    const mtime = fileMtimeSecs(path) ?? now;
    let st = this.claudeFiles.get(path);
    if (!st) {
      st = { tail: new TailState(this.storedOffsets.get(path) ?? 0), title: null, cwd: null, seen: new Map() };
      this.claudeFiles.set(path, st);
    }
    const added: Array<[number, number, number]> = [];
    let tokensAdded = 0;
    const file = st;
    try {
      readNewLines(path, file.tail, (line) => {
        const r = claude.parseLine(line);
        if (!r) return;
        if (r.kind === "title") {
          file.title = r.title;
          return;
        }
        const u = r.usage;
        // o mesmo message.id aparece em várias linhas (uma por bloco): conta só o acréscimo
        const prev = file.seen.get(u.messageId) ?? [0, 0];
        const dw = Math.max(0, u.weighted - prev[0]);
        const dt = Math.max(0, u.tokens - prev[1]);
        if (dw > 0 || dt > 0) {
          added.push([Math.floor(u.ts / 60), dw, dt]);
          tokensAdded += dt;
        }
        file.seen.set(u.messageId, [Math.max(u.weighted, prev[0]), Math.max(u.tokens, prev[1])]);
        if (u.cwd) file.cwd = u.cwd;
      });
    } catch {
      return;
    }
    if (file.seen.size > 20_000) file.seen.clear();
    const cutoff = Math.floor((now - WEEK) / 60);
    for (const [m, w, t] of added) {
      if (m < cutoff) continue;
      const e = this.minutes.get(m) ?? [0, 0];
      this.minutes.set(m, [e[0] + w, e[1] + t]);
      this.dirtyMinutes.add(m);
    }
    this.storedOffsets.set(path, file.tail.offset);
    this.dirtyOffsets.add(path);
    if (now - mtime >= GONE_SECS) return;

    let label: string;
    let agentType: string | null = null;
    let finished = false;
    if (kind.kind === "main") {
      label = file.title ?? claude.labelFromCwd(file.cwd) ?? `sessão ${kind.sessionId.slice(0, 6)}`;
    } else {
      let meta: claude.AgentMeta = { agentType: null, description: null, finished: false };
      try {
        meta = claude.parseAgentMeta(readFileSync(path.replace(/\.jsonl$/, ".meta.json"), "utf8"));
      } catch {
        /* sem meta ainda */
      }
      label = meta.description ?? meta.agentType ?? `agente ${kind.agentId.slice(0, 6)}`;
      agentType = meta.agentType;
      finished = meta.finished;
    }
    this.sessions.touch({
      key: path,
      tool: "claude",
      kind: kind.kind,
      agentType,
      label,
      activity: mtime,
      tokens: 0,
      finished,
    });
    this.sessions.addTokens(path, tokensAdded);
  }

  /** Soma de tokens ponderados nas janelas de 5h e 7d. */
  windowSums(now: number): [number, number] {
    const from5 = Math.floor((now - FIVE_HOURS) / 60);
    const from7 = Math.floor((now - WEEK) / 60);
    let s5 = 0;
    let s7 = 0;
    for (const [m, [w]] of this.minutes) {
      if (m < from7) continue;
      s7 += w;
      if (m >= from5) s5 += w;
    }
    return [s5, s7];
  }

  setExact(r: { ok: ApiUsage } | { error: string }, now: number): void {
    if ("error" in r) {
      this.exactError = r.error;
      return;
    }
    const u = r.ok;
    const [s5, s7] = this.windowSums(now);
    if (u.fiveHour) this.caps.five = calibrate(s5, u.fiveHour.utilization, this.caps.five);
    if (u.sevenDay) this.caps.week = calibrate(s7, u.sevenDay.utilization, this.caps.week);
    if ((u.fiveHour?.utilization ?? 0) >= 3 || (u.sevenDay?.utilization ?? 0) >= 3) {
      this.caps.calibrated = true;
      this.store.set("claude_cap_5h", String(this.caps.five));
      this.store.set("claude_cap_7d", String(this.caps.week));
      this.store.setBool("claude_cap_cal", true);
    }
    this.exact = { five: u.fiveHour, week: u.sevenDay, readAt: now };
    this.exactError = null;
  }

  snapshot(now: number): Snapshot {
    const sessions = this.sessions.snapshot(now);
    const codexUsage = codex.usageFromSample(this.codexLatest, now);
    const [s5, s7] = this.windowSums(now);
    const exactOn = this.store.getBool("claude_exact", true);
    const claudeUsage = buildClaudeUsage(now, s5, s7, this.caps, exactOn ? this.exact : null);
    const snap: Snapshot = {
      claude: claudeUsage,
      codex: codexUsage,
      sessions,
      updatedAt: now,
      claudeExactError: exactOn ? this.exactError : null,
    };
    this.recordSamplesAndPace(snap, now);
    return snap;
  }

  private recordSamplesAndPace(snap: Snapshot, now: number): void {
    for (const tool of ["claude", "codex"] as Tool[]) {
      const u = snap[tool];
      const windows: Array<["5h" | "7d", number, number, Limit | null]> = [
        ["5h", FIVE_HOURS, 3 * 3600, u.fiveHour],
        ["7d", WEEK, 2 * 86_400, u.weekly],
      ];
      for (const [win, secs, lookback, l] of windows) {
        if (!l || l.renewed) continue;
        const key = `${tool}|${win}`;
        const last = this.lastSample.get(key);
        let due = true;
        if (last) {
          const [ts, pct, readAt] = last;
          const changed = Math.abs(l.usedPercent - pct) >= 1;
          due = l.source === "log" ? l.readAt > readAt && (now - ts >= 60 || changed) : now - ts >= 300 || changed;
        }
        const sampleTs = l.source === "log" ? l.readAt : now;
        if (due) {
          this.store.addSample(sampleTs, tool, win, l.usedPercent);
          this.lastSample.set(key, [sampleTs, l.usedPercent, l.readAt]);
        }
        const pts = this.store.samplesSince(tool, win, now - lookback);
        pts.push([sampleTs, l.usedPercent]);
        const windowStart = l.resetsAt != null ? l.resetsAt - secs : now - secs;
        l.projectedExhaustAt = projectExhaustion(pts, now, windowStart, lookback, l.usedPercent);
      }
    }
  }

  /** Grava no SQLite o que mudou e apaga dados antigos (no máximo 1x por hora). */
  flush(now: number): void {
    if (this.dirtyMinutes.size) {
      const rows: Array<[number, number, number]> = [];
      for (const m of this.dirtyMinutes) {
        const v = this.minutes.get(m);
        if (v) rows.push([m, v[0], v[1]]);
      }
      this.store.saveMinutes(rows);
      this.dirtyMinutes.clear();
    }
    if (this.dirtyOffsets.size) {
      const rows: Array<[string, number]> = [];
      for (const p of this.dirtyOffsets) {
        const o = this.storedOffsets.get(p);
        if (o != null) rows.push([p, o]);
      }
      this.store.saveOffsets(rows);
      this.dirtyOffsets.clear();
    }
    if (now - this.lastPrune >= 3600) {
      this.lastPrune = now;
      const cutoff = Math.floor((now - WEEK - 86_400) / 60);
      for (const m of [...this.minutes.keys()]) if (m < cutoff) this.minutes.delete(m);
      this.store.pruneMinutes(cutoff);
      this.store.pruneSamples(now - 30 * 86_400);
    }
  }
}
