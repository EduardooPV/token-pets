// Cor e personalidade dos bonecos. A cor do agente vem do `color` do frontmatter (Claude Code) ou, sem ele,
// de um hash estável do nome; o traço (falas e jeito) vem da fantasia do tipo de agente.
import { PALETTE, costumeForAgent, type Character, type Costume, type PetState } from "./sprites";

/** Nomes de cor aceitos no frontmatter dos agentes do Claude Code. */
const NAMED: Record<string, string> = {
  red: "#e5484d",
  blue: "#4c8df6",
  green: "#46be78",
  yellow: "#f5c542",
  purple: "#a06cf0",
  orange: "#f08a3c",
  pink: "#ff8fc7",
  cyan: "#2cc4d6",
};

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Cor do agente: `override` (nome do Claude Code ou #hex) > hash do nome. Sessão principal (sem tipo) = null (cor original). */
export function agentColor(agentType: string | null, override?: string | null): string | null {
  if (!agentType) return null;
  const o = override?.trim().toLowerCase();
  if (o && NAMED[o]) return NAMED[o];
  if (o && /^#[0-9a-f]{6}$/.test(o)) return o;
  return hslToHex(hashString(agentType.toLowerCase()) % 360, 0.65, 0.58);
}

export function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * factor)))
      .toString(16)
      .padStart(2, "0");
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

const palettes = new Map<string, Record<string, string>>();

/** Paleta com o corpo na cor do agente (claudezinho: O/D; codexzinho: B/b). Sem cor, a paleta original. */
export function paletteFor(character: Character, color: string | null): Record<string, string> {
  if (!color) return PALETTE;
  const key = `${character}|${color}`;
  let p = palettes.get(key);
  if (!p) {
    p = character === "claude" ? { ...PALETTE, O: color, D: shade(color, 0.62) } : { ...PALETTE, B: color, b: shade(color, 0.62) };
    palettes.set(key, p);
  }
  return p;
}

const QUIPS: Record<Costume, string[]> = {
  magnifier: ["Deixa eu ver isso de perto…", "Achei um detalhe!", "Hmm, suspeito."],
  shield: ["Ninguém passa daqui.", "Isso é seguro mesmo?", "Olho aberto."],
  pen: ["Que tal outro título?", "Quase poético.", "Rascunho pronto!"],
  map: ["Tem um atalho por aqui.", "Explorando…", "Você está aqui ✕"],
  generic: ["Trabalhando nisso!", "Pode contar comigo."],
  none: ["Oi!", "Tô por aqui.", "Bora codar?"],
};

const CODEX_QUIPS = ["bip bop", "compilando…", "tudo certo por aqui"];

export function quipFor(character: Character, agentType: string | null, seed: number): string {
  const list = character === "codex" && !agentType ? CODEX_QUIPS : QUIPS[costumeForAgent(agentType)];
  return list[Math.abs(seed) % list.length];
}

const STATE_TEXT: Record<PetState, string> = {
  idle: "de boa",
  working: "trabalhando",
  waiting: "esperando você",
  tired: "cansado (uso ≥ 80%)",
  exhausted: "exausto (uso ≥ 95%)",
  sleeping: "dormindo",
  celebrating: "limite renovado!",
};

export function stateText(state: PetState): string {
  return STATE_TEXT[state];
}

/** Velocidade de passeio (px/s) por estado; 0 = fica parado. */
export function walkSpeed(state: PetState): number {
  switch (state) {
    case "idle":
    case "waiting":
      return 30;
    case "tired":
      return 14;
    case "celebrating":
      return 45;
    default:
      return 0;
  }
}
