// Cor dos agentes personalizados: lê o frontmatter (`name`, `color`) de `.claude/agents/*.md`
// no repositório da sessão (sobe as pastas) e em `~/.claude/agents`. Só leitura, com cache curto.
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const TTL_MS = 60_000;
const MAX_LEVELS = 8;

export function parseAgentFrontmatter(text: string): { name: string; color: string | null } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const field = (key: string): string | null => {
    const r = new RegExp(`^${key}:[ \t]*(.+?)[ \t]*\r?$`, "mi").exec(m[1]);
    return r ? r[1].replace(/^["']|["']$/g, "") : null;
  };
  const name = field("name");
  return name ? { name, color: field("color") } : null;
}

function readDir(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      const fm = parseAgentFrontmatter(readFileSync(join(dir, f), "utf8"));
      if (fm?.color) out.set(fm.name.toLowerCase(), fm.color);
    } catch {
      /* arquivo ilegível: ignora */
    }
  }
  return out;
}

export class AgentColors {
  private cache = new Map<string, { at: number; map: Map<string, string> }>();

  constructor(private readonly home: string = homedir()) {}

  private dirMap(dir: string, now: number): Map<string, string> {
    const hit = this.cache.get(dir);
    if (hit && now - hit.at < TTL_MS) return hit.map;
    const map = readDir(dir);
    this.cache.set(dir, { at: now, map });
    return map;
  }

  /** Cor declarada pelo agente (nome do Claude Code ou #hex), ou null. O repo da sessão vence o `~/.claude`. */
  lookup(agentType: string | null, cwd: string | null, now = Date.now()): string | null {
    if (!agentType) return null;
    const key = agentType.toLowerCase();
    const dirs: string[] = [];
    let cur = cwd;
    for (let i = 0; cur && i < MAX_LEVELS; i++) {
      dirs.push(join(cur, ".claude", "agents"));
      const up = dirname(cur);
      if (up === cur) break;
      cur = up;
    }
    dirs.push(join(this.home, ".claude", "agents"));
    for (const d of dirs) {
      const c = this.dirMap(d, now).get(key);
      if (c) return c;
    }
    return null;
  }
}
