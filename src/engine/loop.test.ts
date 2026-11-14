import { afterEach, describe, expect, it, vi } from "vitest";
import { AnimationLoop } from "./animation";

afterEach(() => vi.unstubAllGlobals());

function clock() {
  let pending: FrameRequestCallback | null = null;
  let visibility: (() => void) | null = null;
  const doc = { hidden: false, addEventListener: (_: string, cb: () => void) => { visibility = cb; }, removeEventListener: () => {} };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { pending = cb; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => { pending = null; });
  return {
    frame(t: number) { const cb = pending; pending = null; cb?.(t); },
    visible(on: boolean) { doc.hidden = !on; visibility?.(); },
  };
}

describe("cadência do movimento", () => {
  it.each([60, 120, 144])("mantém ~60 fps em um monitor de %i Hz", (hz) => {
    const c = clock();
    const draw = vi.fn();
    const loop = new AnimationLoop(draw, () => 60);
    loop.start();
    for (let i = 0; i < hz; i++) c.frame(i * 1000 / hz);
    expect(draw.mock.calls.length).toBeGreaterThanOrEqual(59);
    expect(draw.mock.calls.length).toBeLessThanOrEqual(61);
    loop.stop();
  });
  it("mantém a cadência com eventos de ponteiro em todos os quadros de 144 Hz", () => {
    const c = clock();
    const draw = vi.fn();
    const loop = new AnimationLoop(draw, () => 60);
    loop.start();
    for (let i = 0; i < 144; i++) {
      loop.requestDraw();
      c.frame(i * 1000 / 144);
    }
    expect(draw.mock.calls.length).toBe(60);
    loop.stop();
  });
  it("responde no próximo quadro mesmo em repouso e pausa oculta", () => {
    const c = clock();
    const draw = vi.fn();
    const loop = new AnimationLoop(draw);
    loop.start();
    c.frame(0);
    c.frame(16);
    expect(draw).toHaveBeenCalledTimes(1);
    loop.requestDraw();
    c.frame(32);
    expect(draw).toHaveBeenCalledTimes(2);
    c.visible(false);
    c.frame(1000);
    expect(draw).toHaveBeenCalledTimes(2);
    c.visible(true);
    c.frame(1016);
    expect(draw).toHaveBeenCalledTimes(3);
    loop.stop();
    c.frame(1100);
    expect(draw).toHaveBeenCalledTimes(3);
  });
});
