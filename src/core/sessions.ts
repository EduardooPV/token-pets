// Rastreia sessões e subagentes ativos em memória (nenhuma varredura de disco aqui).
import type { SessionInfo, SessionKind, SessionStatus, Tool } from "../shared/types";

/** Menos de 90 s sem atividade = trabalhando; até 10 min = parado/esperando você; depois some. */
export const WORKING_SECS = 90;
export const GONE_SECS = 600;
/** Subagente já finalizado some logo após o último evento. */
export const FINISHED_GONE_SECS = 45;

interface Entry {
  tool: Tool;
  kind: SessionKind;
  agentType: string | null;
  agentColor: string | null;
  label: string;
  lastActivity: number;
  tokens: number;
  finished: boolean;
}

export interface Touch {
  key: string;
  tool: Tool;
  kind: SessionKind;
  agentType: string | null;
  agentColor?: string | null;
  label: string;
  activity: number;
  tokens: number;
  finished: boolean;
}

export function statusFor(ageSecs: number): SessionStatus | null {
  if (ageSecs < WORKING_SECS) return "working";
  if (ageSecs < GONE_SECS) return "waiting";
  return null;
}

export class SessionTracker {
  private entries = new Map<string, Entry>();

  touch(t: Touch): void {
    const e = this.entries.get(t.key) ?? {
      tool: t.tool,
      kind: t.kind,
      agentType: null,
      agentColor: null,
      label: "",
      lastActivity: 0,
      tokens: 0,
      finished: false,
    };
    e.kind = t.kind;
    if (t.agentType) e.agentType = t.agentType;
    if (t.agentColor) e.agentColor = t.agentColor;
    if (t.label) e.label = t.label;
    e.lastActivity = Math.max(e.lastActivity, t.activity);
    e.tokens = Math.max(e.tokens, t.tokens);
    e.finished = t.finished;
    this.entries.set(t.key, e);
  }

  addTokens(key: string, tokens: number): void {
    const e = this.entries.get(key);
    if (e) e.tokens += tokens;
  }

  /** Sessões visíveis agora, trabalhando primeiro e mais recentes antes. Remove as expiradas. */
  snapshot(now: number): SessionInfo[] {
    for (const [k, e] of this.entries) {
      const age = now - e.lastActivity;
      if (age >= GONE_SECS || (e.finished && age >= FINISHED_GONE_SECS)) this.entries.delete(k);
    }
    const out: SessionInfo[] = [];
    for (const [id, e] of this.entries) {
      const status: SessionStatus | null = e.finished ? "waiting" : statusFor(now - e.lastActivity);
      if (!status) continue;
      out.push({ id, tool: e.tool, kind: e.kind, agentType: e.agentType, agentColor: e.agentColor, label: e.label, status, lastActivity: e.lastActivity, tokens: e.tokens });
    }
    out.sort(
      (a, b) =>
        Number(a.status !== "working") - Number(b.status !== "working") || b.lastActivity - a.lastActivity || a.id.localeCompare(b.id),
    );
    return out;
  }

  get size(): number {
    return this.entries.size;
  }
}
