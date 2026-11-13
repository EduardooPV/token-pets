// % exato do plano Claude via endpoint de uso da conta (o mesmo dado do `/usage`).
//
// Regras de segurança: o token é lido do disco só para esta chamada, nunca é renovado, gravado, exibido ou
// registrado em log, e só é enviado para api.anthropic.com. Mensagens de erro nunca incluem o token.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseIso8601 } from "./util";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

export interface ApiWindow {
  utilization: number;
  resetsAt: number | null;
}

export interface ApiUsage {
  fiveHour: ApiWindow | null;
  sevenDay: ApiWindow | null;
}

function win(v: any): ApiWindow | null {
  if (!v || typeof v.utilization !== "number") return null;
  return {
    utilization: Math.max(0, Math.min(100, v.utilization)),
    resetsAt: typeof v.resets_at === "string" ? parseIso8601(v.resets_at) : null,
  };
}

export function parseUsage(v: any): ApiUsage | null {
  const u = { fiveHour: win(v?.five_hour), sevenDay: win(v?.seven_day) };
  return u.fiveHour || u.sevenDay ? u : null;
}

/** Extrai o token de acesso e valida a expiração (`expiresAt` em ms). Não renova. */
export function tokenFromCredentials(json: string, nowSecs: number): string {
  let v: any;
  try {
    v = JSON.parse(json);
  } catch {
    throw new Error("credenciais ilegíveis");
  }
  const oauth = v?.claudeAiOauth;
  const token = oauth?.accessToken;
  if (typeof token !== "string" || !token) throw new Error("sem login do Claude Code");
  if (typeof oauth.expiresAt === "number" && oauth.expiresAt / 1000 <= nowSecs) {
    throw new Error("login expirado (abra o Claude Code)");
  }
  return token;
}

export async function fetchUsage(nowSecs: number): Promise<ApiUsage> {
  let raw: string;
  try {
    raw = readFileSync(join(homedir(), ".claude", ".credentials.json"), "utf8");
  } catch {
    throw new Error("credenciais do Claude Code não encontradas");
  }
  const token = tokenFromCredentials(raw, nowSecs);
  let resp: Response;
  try {
    resp = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20", "User-Agent": "token-pets/0.1" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("sem conexão com a Anthropic");
  }
  if (resp.status === 401 || resp.status === 403) throw new Error("login recusado (abra o Claude Code)");
  if (resp.status !== 200) throw new Error(`endpoint de uso respondeu ${resp.status}`);
  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    throw new Error("resposta inesperada");
  }
  const u = parseUsage(body);
  if (!u) throw new Error("formato de resposta mudou");
  return u;
}
