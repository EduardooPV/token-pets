import { describe, expect, it } from "vitest";
import { ANIMATIONS, PET_STATES, frameAt, petStateFor } from "./animation";
import { GRID, buildFrame, costumeForAgent, type Character, type Costume } from "./sprites";
import type { Limit, ToolUsage } from "../shared/types";

const limit = (usedPercent: number, renewed = false): Limit => ({
  usedPercent,
  resetsAt: null,
  windowMinutes: 300,
  source: "log",
  readAt: 0,
  renewed,
  projectedExhaustAt: null,
});

const usage = (h5: number | null, wk: number | null, renewed = false): ToolUsage => ({
  tool: "codex",
  plan: null,
  fiveHour: h5 == null ? null : limit(h5, renewed),
  weekly: wk == null ? null : limit(wk),
  calibrated: false,
});

describe("petStateFor", () => {
  it("mapeia sessão e uso para o estado de animação", () => {
    expect(petStateFor({ status: "working" }, usage(10, 20))).toBe("working");
    expect(petStateFor({ status: "waiting" }, usage(10, 20))).toBe("waiting");
    expect(petStateFor(null, usage(10, 20))).toBe("sleeping");
    expect(petStateFor({ status: "working" }, usage(10, 80))).toBe("tired");
    expect(petStateFor({ status: "working" }, usage(96, 20))).toBe("exhausted");
    expect(petStateFor({ status: "waiting" }, usage(0, 20, true))).toBe("celebrating");
  });

  it("sem dados trata como ocioso/dormindo, não como cansado", () => {
    expect(petStateFor(null, usage(null, null))).toBe("sleeping");
    expect(petStateFor({ status: "waiting" }, usage(null, null))).toBe("waiting");
  });
});

describe("animações", () => {
  it("todo estado tem animação definida", () => {
    expect(PET_STATES.sort()).toEqual(
      ["celebrating", "exhausted", "idle", "sleeping", "tired", "waiting", "working"].sort(),
    );
    for (const s of PET_STATES) {
      expect(ANIMATIONS[s].frames).toBeGreaterThanOrEqual(2);
      expect(ANIMATIONS[s].ms).toBeGreaterThan(0);
    }
  });

  it("frameAt cicla pelos quadros", () => {
    const { frames, ms } = ANIMATIONS.working;
    expect(frameAt("working", 0)).toBe(0);
    expect(frameAt("working", ms)).toBe(1);
    expect(frameAt("working", ms * frames)).toBe(0);
  });

  it("todo estado × personagem × fantasia gera quadros não vazios dentro da grade", () => {
    const costumes: Costume[] = ["none", "magnifier", "shield", "pen", "map", "generic"];
    for (const c of ["claude", "codex"] as Character[]) {
      for (const s of PET_STATES) {
        for (let f = 0; f < ANIMATIONS[s].frames; f++) {
          for (const cos of costumes) {
            const g = buildFrame(c, s, f, cos);
            expect(g).toHaveLength(GRID);
            expect(g.every((row) => row.length === GRID)).toBe(true);
            expect(g.flat().some(Boolean)).toBe(true);
          }
        }
      }
    }
  });

  it("estados diferentes produzem desenhos diferentes", () => {
    const a = JSON.stringify(buildFrame("claude", "idle", 0));
    expect(JSON.stringify(buildFrame("claude", "exhausted", 0))).not.toBe(a);
    expect(JSON.stringify(buildFrame("codex", "idle", 0))).not.toBe(a);
  });

  it("o codexzinho tem silhueta e cores próprias, não só outra cor do claudezinho", () => {
    const shape = (g: string[][]) => g.map((row) => row.map((c) => (c ? "#" : ".")).join("")).join("/");
    expect(shape(buildFrame("codex", "idle", 0))).not.toBe(shape(buildFrame("claude", "idle", 0)));
    const colors = (g: string[][]) => new Set(g.flat().filter(Boolean));
    expect(colors(buildFrame("codex", "idle", 0)).has("C")).toBe(true); // rosto brilhante
    expect(colors(buildFrame("claude", "idle", 0)).has("C")).toBe(false);
    expect(colors(buildFrame("claude", "idle", 0)).has("O")).toBe(true);
    expect(colors(buildFrame("codex", "idle", 0)).has("O")).toBe(false);
  });
});

describe("costumeForAgent", () => {
  it("escolhe a fantasia pelo tipo de subagente", () => {
    expect(costumeForAgent("code-reviewer")).toBe("magnifier");
    expect(costumeForAgent("security-probe")).toBe("shield");
    expect(costumeForAgent("copywriter")).toBe("pen");
    expect(costumeForAgent("codebase-explorer")).toBe("map");
    expect(costumeForAgent("algo-novo")).toBe("generic");
    expect(costumeForAgent(null)).toBe("none");
  });
});
