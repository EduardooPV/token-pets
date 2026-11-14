import type { Tool } from "../shared/types";

const NAMES = ["Aurora", "Biscoito", "Caju", "Duna", "Estrela", "Flora", "Garoa", "Jujuba",
  "Kiwi", "Luna", "Manga", "Nuvem", "Pipoca", "Sol", "Tico", "Zeca"];

/** Nome estável entre reinícios, sem expor UUIDs ou nomes de arquivo. */
export function companionName(tool: Tool, key: string): string {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return `${tool === "claude" ? "Claude" : "Codex"} · ${NAMES[(hash >>> 0) % NAMES.length]}`;
}

export function agentLabel(type: string | null): string | null {
  if (!type?.trim()) return null;
  const roles: Record<string, string> = {
    "code-reviewer": "Revisor de código", "security-probe": "Guardião de segurança",
    "codebase-explorer": "Explorador", "general-purpose": "Assistente", default: "Assistente",
    explorer: "Explorador", worker: "Construtor", planner: "Planejador", copywriter: "Redator",
  };
  const value = type.trim();
  return roles[value.toLowerCase()] ?? value.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Em worktrees, mostra o projeto em vez de um nome temporário com hash. */
export function projectLabel(cwd: string | null | undefined): string | null {
  const parts = cwd?.split(/[\\/]/).filter(Boolean);
  if (!parts?.length) return null;
  const marker = parts.findIndex((p, i) => (p === ".claude" || p === ".codex") && parts[i + 1] === "worktrees");
  return (marker > 0 ? parts[marker - 1] : parts.at(-1)) ?? null;
}
