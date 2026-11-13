import { describe, expect, it } from "vitest";
import { barLevel, formatAge, formatDuration, formatPercent, limitCaption, projectionText } from "./format";
import type { Limit } from "./types";

const base: Limit = {
  usedPercent: 40,
  resetsAt: 10_000 + 3600,
  windowMinutes: 300,
  source: "log",
  readAt: 10_000 - 7200,
  renewed: false,
  projectedExhaustAt: null,
};

describe("format", () => {
  it("formata porcentagem com limites e ausência", () => {
    expect(formatPercent(63.6)).toBe("64%");
    expect(formatPercent(120)).toBe("100%");
    expect(formatPercent(null)).toBe("--");
  });

  it("formata duração", () => {
    expect(formatDuration(10)).toBe("agora");
    expect(formatDuration(300)).toBe("5 min");
    expect(formatDuration(2 * 3600 + 10 * 60)).toBe("2 h 10 min");
    expect(formatDuration(3 * 86400 + 4 * 3600)).toBe("3 d 4 h");
  });

  it("formata idade do dado", () => {
    expect(formatAge(100, 130)).toBe("lido agora");
    expect(formatAge(0, 7200)).toBe("lido há 2 h");
  });

  it("classifica o nível da barra", () => {
    expect(barLevel(79)).toBe("ok");
    expect(barLevel(80)).toBe("warn");
    expect(barLevel(95)).toBe("danger");
  });

  it("monta a legenda com idade e reset", () => {
    expect(limitCaption(base, 10_000)).toBe("lido há 2 h · renova em 1 h");
    expect(limitCaption({ ...base, renewed: true }, 10_000)).toBe("renovado · lido há 2 h");
    expect(limitCaption({ ...base, source: "exact", readAt: 9_990 }, 10_000)).toBe("exato · renova em 1 h");
    expect(limitCaption({ ...base, source: "estimated", readAt: 9_990 }, 10_000)).toContain("estimado");
  });

  it("só mostra projeção que acontece antes do reset", () => {
    expect(projectionText(base, 10_000)).toBeNull();
    const soon = { ...base, projectedExhaustAt: 10_000 + 600 };
    expect(projectionText(soon, 10_000)).toMatch(/^nesse ritmo acaba /);
    expect(projectionText({ ...soon, projectedExhaustAt: base.resetsAt! + 1 }, 10_000)).toBeNull();
    expect(projectionText({ ...soon, renewed: true }, 10_000)).toBeNull();
  });
});
