// Coletor local do Claude: tokens dos transcripts em ~/.claude/projects (estimativa) e classificação de arquivos.
import { relative, sep } from "node:path";
import { parseIso8601 } from "./util";

export interface UsageLine {
  messageId: string;
  ts: number;
  /** tokens ponderados por custo relativo (ver `weigh`) */
  weighted: number;
  /** soma bruta: entrada + saída + cache */
  tokens: number;
  cwd: string | null;
}

export type ParsedLine = { kind: "usage"; usage: UsageLine } | { kind: "title"; title: string };

/** Custo relativo aproximado (entrada = 1): saída 5x, escrita de cache 1,25x, leitura de cache 0,1x. */
export function weigh(input: number, output: number, cacheWrite: number, cacheRead: number): number {
  return input + 5 * output + 1.25 * cacheWrite + 0.1 * cacheRead;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function parseLine(line: string): ParsedLine | null {
  const wantsUsage = line.includes('"usage"');
  const wantsTitle = line.includes('"custom-title"');
  if (!wantsUsage && !wantsTitle) return null;
  let v: any;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (v?.type === "custom-title") {
    const t = typeof v.customTitle === "string" ? v.customTitle.trim() : "";
    return t ? { kind: "title", title: v.customTitle } : null;
  }
  if (v?.type !== "assistant") return null;
  const m = v.message;
  const u = m?.usage;
  const ts = parseIso8601(v.timestamp);
  if (!m || !u || typeof m.id !== "string" || ts == null) return null;
  const input = num(u.input_tokens);
  const output = num(u.output_tokens);
  const cw = num(u.cache_creation_input_tokens);
  const cr = num(u.cache_read_input_tokens);
  return {
    kind: "usage",
    usage: { messageId: m.id, ts, weighted: weigh(input, output, cw, cr), tokens: input + output + cw + cr, cwd: typeof v.cwd === "string" ? v.cwd : null },
  };
}

export type FileKind =
  | { kind: "main"; sessionId: string }
  | { kind: "subagent"; sessionId: string; agentId: string };

/**
 * Classifica um .jsonl dentro de ~/.claude/projects:
 * `<proj>/<sessao>.jsonl` (principal) ou `<proj>/<sessao>/subagents/agent-<id>.jsonl` (subagente).
 */
export function classifyPath(path: string, root: string): FileKind | null {
  if (!path.endsWith(".jsonl")) return null;
  const rel = relative(root, path);
  if (!rel || rel.startsWith("..") || /^[a-zA-Z]:/.test(rel)) return null;
  const parts = rel.split(sep).filter(Boolean);
  const stem = (s: string) => s.replace(/\.jsonl$/, "");
  if (parts.length === 2) return { kind: "main", sessionId: stem(parts[1]) };
  if (parts.length === 4 && parts[2] === "subagents" && parts[3].startsWith("agent-")) {
    return { kind: "subagent", sessionId: parts[1], agentId: stem(parts[3]).replace(/^agent-/, "") };
  }
  return null;
}

export interface AgentMeta {
  agentType: string | null;
  description: string | null;
  finished: boolean;
}

export function parseAgentMeta(json: string): AgentMeta {
  try {
    const v = JSON.parse(json);
    return {
      agentType: typeof v.agentType === "string" ? v.agentType : null,
      description: typeof v.description === "string" ? v.description : null,
      finished: v.finished === true,
    };
  } catch {
    return { agentType: null, description: null, finished: false };
  }
}

export function labelFromCwd(cwd: string | null | undefined): string | null {
  return cwd?.split(/[\\/]/).filter(Boolean).pop() ?? null;
}
