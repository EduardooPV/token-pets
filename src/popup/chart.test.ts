import { describe, expect, it } from "vitest";
import { buildChart } from "./chart";
import type { HistoryPoint } from "../shared/types";

const NOW = 1_800_000_000;
const pt = (over: Partial<HistoryPoint>): HistoryPoint => ({ ts: NOW, tool: "codex", window: "7d", pct: 50, ...over });

describe("buildChart", () => {
  it("sem dados não desenha linhas", () => {
    const c = buildChart([], "codex", NOW);
    expect(c.hasData).toBe(false);
    expect(c.paths["5h"]).toBe("");
    expect(c.ticks).toHaveLength(7);
  });

  it("filtra por ferramenta, janela e período de 7 dias, em ordem de tempo", () => {
    const c = buildChart(
      [
        pt({ ts: NOW - 3600, pct: 20 }),
        pt({ ts: NOW - 7200, pct: 10 }),
        pt({ ts: NOW - 8 * 86400, pct: 99 }), // fora do período
        pt({ tool: "claude", pct: 70 }), // outra ferramenta
        pt({ window: "5h", pct: 30 }),
      ],
      "codex",
      NOW,
    );
    expect(c.hasData).toBe(true);
    const segs = c.paths["7d"].split(" L");
    expect(segs).toHaveLength(2); // só 2 pontos válidos
    expect(c.paths["7d"].startsWith("M")).toBe(true);
    expect(c.paths["5h"].startsWith("M")).toBe(true);
  });

  it("mapeia 0% para baixo e 100% para cima, e o presente para a borda direita", () => {
    const low = buildChart([pt({ pct: 0 })], "codex", NOW).paths["7d"];
    const high = buildChart([pt({ pct: 100 })], "codex", NOW).paths["7d"];
    const yOf = (p: string) => Number(p.split(" ")[1]);
    expect(yOf(low)).toBeGreaterThan(yOf(high));
    expect(Number(low.slice(1).split(" ")[0])).toBe(348); // CHART_W - PAD.r
  });

  it("linhas de referência ficam em ordem de cima para baixo", () => {
    const c = buildChart([], "codex", NOW);
    const ys = c.guides.map((g) => g.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });
});
