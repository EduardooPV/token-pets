import { describe, expect, it } from "vitest";
import { MAX_PETS, buildPets } from "./scene";
import type { SessionInfo, Snapshot, ToolUsage } from "../shared/types";

const usage = (tool: "claude" | "codex", pct: number | null): ToolUsage => ({
  tool,
  plan: null,
  fiveHour:
    pct == null
      ? null
      : { usedPercent: pct, resetsAt: null, windowMinutes: 300, source: "log", readAt: 0, renewed: false, projectedExhaustAt: null },
  weekly: null,
  calibrated: false,
});

const session = (i: number, over: Partial<SessionInfo> = {}): SessionInfo => ({
  id: `s${i}`,
  tool: "claude",
  kind: "main",
  agentType: null,
  agentColor: null,
  label: `sessão ${i}`,
  status: "working",
  lastActivity: 0,
  tokens: 0,
  ...over,
});

const snap = (sessions: SessionInfo[], claude = 10, codex = 10): Snapshot => ({
  claude: usage("claude", claude),
  codex: usage("codex", codex),
  sessions,
  updatedAt: 0,
  claudeExactError: null,
});

describe("buildPets", () => {
  it("sem sessões mostra os dois mascotes dormindo", () => {
    const pets = buildPets(snap([]));
    expect(pets.map((p) => [p.character, p.state])).toEqual([
      ["claude", "sleeping"],
      ["codex", "sleeping"],
    ]);
  });

  it("mascote reflete o uso do limite mesmo sem sessão", () => {
    const pets = buildPets(snap([], 97, 82));
    expect(pets.map((p) => p.state)).toEqual(["exhausted", "tired"]);
  });

  it("um boneco por sessão, com fantasia só para subagentes", () => {
    const pets = buildPets(
      snap([
        session(1),
        session(2, { kind: "subagent", agentType: "security-probe", status: "waiting" }),
        session(3, { tool: "codex" }),
      ]),
    );
    expect(pets.map((p) => [p.character, p.costume, p.state])).toEqual([
      ["claude", "none", "working"],
      ["claude", "shield", "waiting"],
      ["codex", "none", "working"],
    ]);
  });

  it("agrupa o excedente em +N no último boneco", () => {
    const many = Array.from({ length: MAX_PETS + 3 }, (_, i) => session(i));
    const pets = buildPets(snap(many));
    expect(pets).toHaveLength(MAX_PETS);
    expect(pets[MAX_PETS - 1].overflow).toBe(4);
    expect(pets[0].overflow).toBeUndefined();
  });
});

describe("cor dos bonecos", () => {
  it("só subagentes são recoloridos; o frontmatter vence o hash", () => {
    const pets = buildPets(
      snap([
        session(1),
        session(2, { kind: "subagent", agentType: "seo-reviewer" }),
        session(3, { kind: "subagent", agentType: "seo-reviewer", agentColor: "red" }),
      ]),
    );
    expect(pets[0].color).toBeNull();
    expect(pets[1].color).toMatch(/^#[0-9a-f]{6}$/);
    expect(pets[2].color).toBe("#e5484d");
  });
});
