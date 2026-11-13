import { describe, expect, it } from "vitest";
import { projectExhaustion } from "./pace";

const NOW = 100_000;

describe("projectExhaustion", () => {
  it("crescimento constante projeta um horário coerente", () => {
    // +10% por hora, agora em 60%: faltam 40% => ~4 h
    const samples: Array<[number, number]> = Array.from({ length: 9 }, (_, i) => [NOW - 7200 + i * 900, 40 + i * 2.5]);
    const t = projectExhaustion(samples, NOW, NOW - 18_000, 3 * 3600, 60)!;
    expect((t - NOW) / 3600).toBeCloseTo(4, 1);
  });

  it("uso estável ou caindo nunca esgota", () => {
    const flat: Array<[number, number]> = Array.from({ length: 6 }, (_, i) => [NOW - 3000 + i * 600, 30]);
    expect(projectExhaustion(flat, NOW, 0, 7200, 30)).toBeNull();
    const falling: Array<[number, number]> = Array.from({ length: 6 }, (_, i) => [NOW - 3000 + i * 600, 50 - i]);
    expect(projectExhaustion(falling, NOW, 0, 7200, 45)).toBeNull();
  });

  it("pouco histórico não gera projeção", () => {
    expect(projectExhaustion([], NOW, 0, 7200, 10)).toBeNull();
    expect(projectExhaustion([[NOW - 60, 10], [NOW, 12]], NOW, 0, 7200, 12)).toBeNull();
    expect(projectExhaustion([[NOW - 200, 10], [NOW - 100, 11], [NOW, 12]], NOW, 0, 7200, 12)).toBeNull();
  });

  it("ignora amostras de antes do reset da janela", () => {
    const samples: Array<[number, number]> = [[NOW - 5000, 90], [NOW - 4900, 95]];
    for (let i = 0; i < 6; i++) samples.push([NOW - 3000 + i * 600, i]);
    const t = projectExhaustion(samples, NOW, NOW - 3100, 10_000, 5)!;
    expect(t).toBeGreaterThan(NOW + 3600 * 10);
  });

  it("já cheio devolve agora", () => {
    expect(projectExhaustion([], 500, 0, 100, 100)).toBe(500);
  });
});
