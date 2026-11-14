// Física mínima do pet flutuante: gravidade, chão, paredes, arremesso e hit-test. Sem DOM, para poder testar.

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Bounds {
  w: number;
  h: number;
  /** lado do sprite (quadrado) */
  size: number;
  /** folga entre o sprite e o chão */
  floorGap?: number;
}

export const GRAVITY = 1800; // px/s²
export const MAX_THROW = 1600; // px/s

export function groundY(b: Bounds): number {
  return b.h - b.size - (b.floorGap ?? 2);
}

export function isGrounded(body: Body, b: Bounds): boolean {
  return body.y >= groundY(b) - 0.5 && Math.abs(body.vy) < 1;
}

/** Avança `dtMs` e devolve a velocidade vertical de impacto quando tocou o chão neste passo (0 se não tocou). */
export function stepBody(body: Body, dtMs: number, b: Bounds): number {
  const dt = Math.min(Math.max(dtMs, 0), 50) / 1000;
  const floor = groundY(b);
  const maxX = Math.max(0, b.w - b.size);
  let impact = 0;

  body.vy += GRAVITY * dt;
  body.x += body.vx * dt;
  body.y += body.vy * dt;

  if (body.x < 0) {
    body.x = 0;
    body.vx = Math.abs(body.vx) * 0.5;
  } else if (body.x > maxX) {
    body.x = maxX;
    body.vx = -Math.abs(body.vx) * 0.5;
  }
  if (body.y < 0) {
    body.y = 0;
    body.vy = Math.abs(body.vy) * 0.3;
  }
  if (body.y >= floor) {
    body.y = floor;
    if (body.vy > 0) {
      impact = body.vy;
      body.vy = body.vy > 260 ? -body.vy * 0.3 : 0;
    }
    body.vx *= Math.pow(0.001, dt); // atrito no chão
    if (Math.abs(body.vx) < 4) body.vx = 0;
  }
  return impact;
}

export interface Sample {
  x: number;
  y: number;
  t: number;
}

/** Velocidade do arremesso a partir das últimas posições do ponteiro (janela de ~120 ms). */
export function throwVelocity(samples: Sample[]): { vx: number; vy: number } {
  if (samples.length < 2) return { vx: 0, vy: 0 };
  const last = samples[samples.length - 1];
  const first = samples.find((s) => last.t - s.t <= 120) ?? samples[0];
  const dt = (last.t - first.t) / 1000;
  if (dt <= 0) return { vx: 0, vy: 0 };
  const clamp = (v: number) => Math.max(-MAX_THROW, Math.min(MAX_THROW, v));
  return { vx: clamp((last.x - first.x) / dt), vy: clamp((last.y - first.y) / dt) };
}

/** Índice do boneco sob o ponto (o último da lista é o desenhado por cima), ou -1. */
export function hitTest(bodies: Body[], px: number, py: number, size: number): number {
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i];
    if (px >= b.x && px < b.x + size && py >= b.y && py < b.y + size) return i;
  }
  return -1;
}
