import type { SessionInfo, Snapshot, Tool } from "../shared/types";
import { petStateFor, usageFor } from "./animation";
import { agentColor } from "./personality";
import { costumeForAgent, type Character, type Costume, type PetState } from "./sprites";

export const MAX_PETS = 8;

export interface PetView {
  key: string;
  character: Character;
  state: PetState;
  costume: Costume;
  label: string;
  tool: Tool;
  agentType: string | null;
  /** cor do corpo (subagentes); null = cor original do personagem */
  color: string | null;
  tokens: number;
  /** bonecos agrupados no "+N" (só no último item de overflow) */
  overflow?: number;
}

function viewFor(s: SessionInfo, snap: Snapshot): PetView {
  return {
    key: s.id,
    character: s.tool,
    state: petStateFor(s, usageFor(s.tool, snap.claude, snap.codex)),
    costume: s.kind === "subagent" ? costumeForAgent(s.agentType) : "none",
    label: s.label,
    tool: s.tool,
    agentType: s.agentType,
    color: s.kind === "subagent" ? agentColor(s.agentType, s.agentColor) : null,
    tokens: s.tokens,
  };
}

/**
 * Lista de bonecos a desenhar: um por sessão/subagente ativo (até 8); o resto vira "+N".
 * Sem sessões ativas aparecem os dois mascotes, dormindo (ou comemorando/cansados conforme o uso).
 */
export function buildPets(snap: Snapshot): PetView[] {
  if (snap.sessions.length === 0) {
    return (["claude", "codex"] as const).map((tool) => ({
      key: `mascot-${tool}`,
      character: tool,
      state: petStateFor(null, usageFor(tool, snap.claude, snap.codex)),
      costume: "none" as const,
      label: tool === "claude" ? "Claude" : "Codex",
      tool,
      agentType: null,
      color: null,
      tokens: 0,
    }));
  }
  const shown = snap.sessions.slice(0, MAX_PETS).map((s) => viewFor(s, snap));
  const extra = snap.sessions.length - MAX_PETS;
  if (extra > 0) shown[shown.length - 1] = { ...shown[shown.length - 1], overflow: extra + 1 };
  return shown;
}
