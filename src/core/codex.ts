// Coletor do Codex: lê `token_count` + `rate_limits` dos rollouts em ~/.codex/sessions.
import type { Limit, ToolUsage } from "../shared/types";
import { parseIso8601 } from "./util";

export interface RawLimit {
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number | null;
}

export interface CodexSample {
  /** epoch (s) do evento no log */
  ts: number;
  primary: RawLimit | null;
  secondary: RawLimit | null;
  plan: string | null;
  totalTokens: number | null;
}

interface RawWindow {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
}

function raw(w: RawWindow | null | undefined): RawLimit | null {
  if (!w || typeof w.used_percent !== "number") return null;
  return { usedPercent: w.used_percent, windowMinutes: w.window_minutes ?? 0, resetsAt: w.resets_at ?? null };
}

/** Interpreta uma linha do rollout. Só devolve algo para `token_count` do limite principal ("codex"). */
export function parseLine(line: string): CodexSample | null {
  if (!line.includes('"token_count"')) return null;
  let v: any;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  const p = v?.payload;
  if (!p || p.type !== "token_count") return null;
  const ts = parseIso8601(v.timestamp);
  if (ts == null) return null;
  const totalTokens = typeof p.info?.total_token_usage?.total_tokens === "number" ? p.info.total_token_usage.total_tokens : null;
  const rl = p.rate_limits;
  if (rl && typeof rl.limit_id === "string" && rl.limit_id !== "codex") return null; // limites por modelo
  return {
    ts,
    primary: raw(rl?.primary),
    secondary: raw(rl?.secondary),
    plan: typeof rl?.plan_type === "string" ? rl.plan_type : null,
    totalTokens,
  };
}

function limitFrom(r: RawLimit, sampleTs: number, now: number, defaultWindow: number): Limit {
  const renewed = r.resetsAt != null && r.resetsAt <= now;
  return {
    usedPercent: renewed ? 0 : r.usedPercent,
    resetsAt: renewed ? null : r.resetsAt,
    windowMinutes: r.windowMinutes > 0 ? r.windowMinutes : defaultWindow,
    source: "log",
    readAt: sampleTs,
    renewed,
    projectedExhaustAt: null,
  };
}

/** Janelas cujo reset já passou ficam zeradas e marcadas como "renovado". */
export function usageFromSample(sample: CodexSample | null, now: number): ToolUsage {
  const u: ToolUsage = { tool: "codex", plan: null, fiveHour: null, weekly: null, calibrated: false };
  if (sample) {
    u.plan = sample.plan;
    u.fiveHour = sample.primary ? limitFrom(sample.primary, sample.ts, now, 300) : null;
    u.weekly = sample.secondary ? limitFrom(sample.secondary, sample.ts, now, 10080) : null;
  }
  return u;
}

export interface SessionMeta {
  id: string | null;
  cwd: string | null;
  isSubagent: boolean;
}

export function parseSessionMeta(firstLine: string): SessionMeta | null {
  let v: any;
  try {
    v = JSON.parse(firstLine);
  } catch {
    return null;
  }
  if (v?.type !== "session_meta" || !v.payload) return null;
  const p = v.payload;
  return {
    id: typeof p.id === "string" ? p.id : null,
    cwd: typeof p.cwd === "string" ? p.cwd : null,
    isSubagent: p.parent_thread_id != null,
  };
}

export function labelFromCwd(cwd: string | null | undefined, fallback = "Codex"): string {
  const last = cwd?.split(/[\\/]/).filter(Boolean).pop();
  return last || fallback;
}
