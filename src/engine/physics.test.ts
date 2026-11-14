import { describe, expect, it } from "vitest";
import { groundY, hitTest, isGrounded, stepBody, throwVelocity, type Body } from "./physics";

const bounds = { w: 400, h: 300, size: 48 };

describe("stepBody", () => {
  it("cai e pousa no chão", () => {
    const b: Body = { x: 100, y: 0, vx: 0, vy: 0 };
    for (let i = 0; i < 200; i++) stepBody(b, 16, bounds);
    expect(b.y).toBe(groundY(bounds));
    expect(isGrounded(b, bounds)).toBe(true);
  });

  it("devolve o impacto só no passo em que toca o chão", () => {
    const b: Body = { x: 0, y: groundY(bounds) - 1, vx: 0, vy: 600 };
    expect(stepBody(b, 16, bounds)).toBeGreaterThan(0);
    const air: Body = { x: 0, y: 0, vx: 0, vy: 0 };
    expect(stepBody(air, 16, bounds)).toBe(0);
  });

  it("não sai da tela pelas laterais", () => {
    const b: Body = { x: 390, y: groundY(bounds), vx: 900, vy: 0 };
    for (let i = 0; i < 30; i++) stepBody(b, 16, bounds);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x).toBeLessThanOrEqual(bounds.w - bounds.size);
  });

  it("o atrito para o boneco no chão", () => {
    const b: Body = { x: 50, y: groundY(bounds), vx: 300, vy: 0 };
    for (let i = 0; i < 120; i++) stepBody(b, 16, bounds);
    expect(b.vx).toBe(0);
  });

  it("limita passos longos (aba oculta) para não teleportar", () => {
    const b: Body = { x: 0, y: 0, vx: 0, vy: 0 };
    stepBody(b, 60_000, bounds);
    expect(b.y).toBeLessThan(10);
  });
});

describe("throwVelocity", () => {
  it("sem amostras suficientes não arremessa", () => {
    expect(throwVelocity([])).toEqual({ vx: 0, vy: 0 });
    expect(throwVelocity([{ x: 1, y: 1, t: 0 }])).toEqual({ vx: 0, vy: 0 });
  });

  it("usa só as amostras recentes e limita a velocidade", () => {
    const v = throwVelocity([
      { x: 0, y: 0, t: 0 },
      { x: 100, y: 0, t: 400 },
      { x: 200, y: 0, t: 450 },
    ]);
    expect(v.vx).toBe(1600); // 100px em 50ms = 2000 -> limitado
    expect(v.vy).toBe(0);
  });

  it("segurar parado dá velocidade zero", () => {
    const v = throwVelocity([
      { x: 10, y: 10, t: 0 },
      { x: 10, y: 10, t: 100 },
    ]);
    expect(v).toEqual({ vx: 0, vy: 0 });
  });
});

describe("hitTest", () => {
  const bodies: Body[] = [
    { x: 0, y: 0, vx: 0, vy: 0 },
    { x: 20, y: 20, vx: 0, vy: 0 },
  ];
  it("acerta o boneco de cima quando sobrepõem", () => {
    expect(hitTest(bodies, 30, 30, 48)).toBe(1);
    expect(hitTest(bodies, 5, 5, 48)).toBe(0);
  });
  it("fora de qualquer boneco devolve -1", () => {
    expect(hitTest(bodies, 200, 200, 48)).toBe(-1);
  });
});
