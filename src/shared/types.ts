// Contrato entre o backend Rust (serde camelCase) e as janelas. Mantenha em sincronia com src-tauri/src/model.rs.

export type Tool = "claude" | "codex";
export type LimitSource = "exact" | "estimated" | "log";
export type SessionStatus = "working" | "waiting";
export type SessionKind = "main" | "subagent";

export interface Limit {
  /** 0..100 */
  usedPercent: number;
  /** epoch em segundos; null quando desconhecido */
  resetsAt: number | null;
  windowMinutes: number;
  source: LimitSource;
  /** epoch em segundos do momento da leitura */
  readAt: number;
  /** o horário de reset já passou: a barra foi zerada e marcada como "renovado" */
  renewed: boolean;
  /** epoch em segundos em que o limite deve acabar no ritmo atual; null se não esgota */
  projectedExhaustAt: number | null;
}

export interface ToolUsage {
  tool: Tool;
  plan: string | null;
  fiveHour: Limit | null;
  weekly: Limit | null;
  /** Claude: true quando o teto da estimativa foi calibrado por uma leitura exata */
  calibrated: boolean;
}

export interface SessionInfo {
  id: string;
  tool: Tool;
  kind: SessionKind;
  agentType: string | null;
  /** cor declarada no frontmatter do agente (nome do Claude Code ou #hex); null = derivar do nome */
  agentColor: string | null;
  label: string;
  status: SessionStatus;
  /** epoch em segundos */
  lastActivity: number;
  tokens: number;
}

export interface Snapshot {
  claude: ToolUsage;
  codex: ToolUsage;
  sessions: SessionInfo[];
  /** epoch em segundos */
  updatedAt: number;
  /** motivo pelo qual o número exato do Claude não está disponível (null = ok ou desligado) */
  claudeExactError: string | null;
}

export interface HistoryPoint {
  ts: number;
  tool: Tool;
  window: "5h" | "7d";
  pct: number;
}

export interface Settings {
  pet: boolean;
  sounds: boolean;
  claudeExact: boolean;
}

export type AlertKind = "threshold80" | "threshold95" | "reset" | "agentDone";

export interface AlertEvent {
  kind: AlertKind;
  title: string;
  body: string;
}
