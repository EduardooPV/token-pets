import { describe, expect, it } from "vitest";
import { agentColor, hashString, paletteFor, quipFor, shade, stateText, walkSpeed } from "./personality";
import { PET_STATES } from "./animation";
import { PALETTE } from "./sprites";

describe("agentColor", () => {
  it("sessão principal mantém a cor original", () => {
    expect(agentColor(null)).toBeNull();
    expect(paletteFor("claude", null)).toBe(PALETTE);
  });

  it("usa o color do frontmatter (nome ou hex)", () => {
    expect(agentColor("seo-reviewer", "Blue")).toBe("#4c8df6");
    expect(agentColor("x", "#aabbcc")).toBe("#aabbcc");
  });

  it("sem override a cor é estável e vem do nome", () => {
    expect(agentColor("seo-reviewer")).toBe(agentColor("seo-reviewer"));
    expect(agentColor("seo-reviewer")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("agentes diferentes recebem cores diferentes", () => {
    const names = ["seo-reviewer", "frontend-reviewer", "accessibility-reviewer", "code-reviewer", "security-probe"];
    const colors = new Set(names.map((n) => agentColor(n)));
    expect(colors.size).toBe(names.length);
  });

  it("override inválido cai para o hash", () => {
    expect(agentColor("a", "nao-existe")).toBe(agentColor("a"));
  });
});

describe("paletteFor", () => {
  it("recolore só o corpo e escurece o contorno", () => {
    const p = paletteFor("claude", "#4c8df6");
    expect(p.O).toBe("#4c8df6");
    expect(p.D).toBe(shade("#4c8df6", 0.62));
    expect(p.K).toBe(PALETTE.K);
    expect(paletteFor("claude", "#4c8df6")).toBe(p);
  });

  it("codexzinho recolore B/b", () => {
    expect(paletteFor("codex", "#e5484d").B).toBe("#e5484d");
  });
});

describe("falas e ritmo", () => {
  it("fala por fantasia é determinística", () => {
    expect(quipFor("claude", "code-reviewer", 0)).toBe(quipFor("claude", "code-reviewer", 0));
    expect(quipFor("codex", null, 1)).toBe("compilando…");
  });

  it("todo estado tem texto e velocidade definida", () => {
    for (const s of PET_STATES) {
      expect(stateText(s).length).toBeGreaterThan(0);
      expect(walkSpeed(s)).toBeGreaterThanOrEqual(0);
    }
    expect(walkSpeed("working")).toBe(0);
  });

  it("hash é estável", () => {
    expect(hashString("a")).toBe(hashString("a"));
  });
});
