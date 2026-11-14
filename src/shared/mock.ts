// Dados de exemplo usados só no `pnpm dev` aberto no navegador (fora do Tauri).
import type { HistoryPoint, Limit, Snapshot } from "./types";

const now = () => Math.floor(Date.now() / 1000);

const limit = (usedPercent: number, over: Partial<Limit> = {}): Limit => ({
  usedPercent,
  resetsAt: now() + 3600 + 1200,
  windowMinutes: 300,
  source: "log",
  readAt: now() - 7200,
  renewed: false,
  projectedExhaustAt: null,
  ...over,
});

export function mockSnapshot(): Snapshot {
  const t = now();
  return {
    claude: {
      tool: "claude",
      plan: null,
      fiveHour: limit(42, { source: "exact", readAt: t - 20 }),
      weekly: limit(31, { source: "estimated", readAt: t, resetsAt: null, windowMinutes: 10080 }),
      calibrated: true,
    },
    codex: {
      tool: "codex",
      plan: "plus",
      fiveHour: limit(64),
      weekly: limit(94, { windowMinutes: 10080, resetsAt: t + 86400, projectedExhaustAt: t + 7200 }),
      calibrated: false,
    },
    sessions: [
      { id: "a", tool: "claude", kind: "main", agentType: null, agentColor: null, label: "Token usage monitoring app", status: "working", lastActivity: t - 5, tokens: 183_000 },
      { id: "b", tool: "claude", kind: "subagent", agentType: "code-reviewer", agentColor: null, label: "Revisão do PR", status: "working", lastActivity: t - 12, tokens: 42_000 },
      { id: "c", tool: "claude", kind: "subagent", agentType: "security-probe", agentColor: null, label: "Sonda de segurança", status: "waiting", lastActivity: t - 200, tokens: 9_000 },
      { id: "d", tool: "claude", kind: "subagent", agentType: "codebase-explorer", agentColor: null, label: "Mapa banco issues", status: "working", lastActivity: t - 8, tokens: 31_000 },
      { id: "e", tool: "codex", kind: "main", agentType: null, agentColor: null, label: "meu-app", status: "working", lastActivity: t - 20, tokens: 683_830 },
    ],
    updatedAt: t,
    claudeExactError: null,
  };
}

export function mockHistory(): HistoryPoint[] {
  const t = now();
  const out: HistoryPoint[] = [];
  for (let i = 7 * 24; i >= 0; i -= 2) {
    const ts = t - i * 3600;
    const wave = (Math.sin(i / 9) + 1) / 2;
    out.push({ ts, tool: "claude", window: "7d", pct: Math.min(100, 8 + (7 * 24 - i) * 0.14) });
    out.push({ ts, tool: "claude", window: "5h", pct: Math.round(wave * 70) });
    out.push({ ts, tool: "codex", window: "7d", pct: Math.min(100, 10 + (7 * 24 - i) * 0.5) });
    out.push({ ts, tool: "codex", window: "5h", pct: Math.round(wave * 90) });
  }
  return out;
}
