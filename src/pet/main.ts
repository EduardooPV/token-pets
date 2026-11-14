// Pet flutuante: a janela cobre a área útil da tela, transparente e sempre no topo. O clique passa direto,
// exceto sobre um boneco (o processo principal alterna "ignorar mouse" conforme o cursor entra/sai de um sprite).
// Dá para arrastar e arremessar os bonecos, clicar (balão com info) e clicar duas vezes (abre o popup).
import { AnimationLoop, frameAt } from "../engine/animation";
import { groundY, hitTest, isGrounded, stepBody, throwVelocity, type Body, type Bounds, type Sample } from "../engine/physics";
import { paletteFor, quipFor, stateText, walkSpeed } from "../engine/personality";
import { buildPets, type PetView } from "../engine/scene";
import { GRID, buildFrame, drawGrid } from "../engine/sprites";
import { formatTokens } from "../shared/format";
import { getSettings, getSnapshot, onAlert, onSettings, onSnapshot, openPopup, setPetInteractive } from "../shared/ipc";
import { playAlertSound } from "../shared/sounds";
import type { Settings } from "../shared/types";

const SCALE = 3;
const SIZE = GRID * SCALE; // 48px por boneco
const SLOT = 56;
const MARGIN = 16;
const BUBBLE_MS = 3500;
const DOUBLE_CLICK_MS = 350;
const CLICK_MAX_MOVE = 5;
const FPS_IDLE = 12;
const FPS_ACTIVE = 30;

interface Pet {
  view: PetView;
  body: Body;
  facing: 1 | -1;
  targetX: number | null;
  nextWanderAt: number;
  hopUntil: number;
  bubble: { lines: string[]; until: number } | null;
  lastClickAt: number;
}

interface Drag {
  key: string;
  dx: number;
  dy: number;
  startX: number;
  startY: number;
  startT: number;
  moved: boolean;
  samples: Sample[];
}

const canvas = document.getElementById("pet") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
let settings: Settings = { pet: true, sounds: false, claudeExact: true };
const pets = new Map<string, Pet>();
let order: string[] = [];
let bounds: Bounds = { w: window.innerWidth, h: window.innerHeight, size: SIZE };
let drag: Drag | null = null;
let interactive = false;
let lastDraw = 0;
let dirty: Array<[number, number, number, number]> = [];

function resize() {
  const dpr = window.devicePixelRatio || 1;
  bounds = { w: window.innerWidth, h: window.innerHeight, size: SIZE };
  canvas.style.width = `${bounds.w}px`;
  canvas.style.height = `${bounds.h}px`;
  canvas.width = Math.round(bounds.w * dpr);
  canvas.height = Math.round(bounds.h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  dirty = [];
  for (const p of pets.values()) {
    p.body.x = Math.max(0, Math.min(p.body.x, bounds.w - SIZE));
    if (p.body.y > groundY(bounds)) p.body.y = groundY(bounds);
  }
}

function syncPets(views: PetView[]) {
  const keys = new Set(views.map((v) => v.key));
  for (const k of [...pets.keys()]) if (!keys.has(k) && drag?.key !== k) pets.delete(k);
  views.forEach((view, i) => {
    const cur = pets.get(view.key);
    if (cur) {
      cur.view = view;
      return;
    }
    // novos bonecos entram da direita, em fila, e caem até o chão
    const x = Math.max(0, bounds.w - MARGIN - (views.length - i) * SLOT);
    pets.set(view.key, {
      view,
      body: { x, y: groundY(bounds) - 60, vx: 0, vy: 0 },
      facing: -1,
      targetX: null,
      nextWanderAt: performance.now() + 1500 + Math.random() * 4000,
      hopUntil: 0,
      bubble: null,
      lastClickAt: 0,
    });
  });
  // mantém a ordem de desenho atual (o último clicado fica por cima) e acrescenta os novos
  order = [...order.filter((k) => keys.has(k)), ...views.map((v) => v.key).filter((k) => !order.includes(k))];
}

function list(): Pet[] {
  return order.map((k) => pets.get(k)).filter((p): p is Pet => Boolean(p));
}

function bubbleFor(p: Pet): string[] {
  const v = p.view;
  const name = v.label.length > 30 ? `${v.label.slice(0, 29)}…` : v.label;
  const tokens = v.tokens > 0 ? ` · ${formatTokens(v.tokens)} tokens` : "";
  return [name, `${stateText(v.state)}${tokens}`, quipFor(v.character, v.agentType, Math.floor(Date.now() / 1000))];
}

function wander(p: Pet, now: number, dt: number) {
  const speed = walkSpeed(p.view.state);
  if (!isGrounded(p.body, bounds) || speed === 0) {
    p.targetX = null;
    return;
  }
  if (p.targetX == null) {
    if (now >= p.nextWanderAt) {
      const span = 40 + Math.random() * 140;
      p.targetX = Math.max(0, Math.min(bounds.w - SIZE, p.body.x + (Math.random() < 0.5 ? -span : span)));
    }
    return;
  }
  const d = p.targetX - p.body.x;
  if (Math.abs(d) < 2) {
    p.targetX = null;
    p.nextWanderAt = now + 2500 + Math.random() * 6000;
    return;
  }
  p.facing = d < 0 ? -1 : 1;
  p.body.x += Math.sign(d) * Math.min(Math.abs(d), speed * (dt / 1000));
}

function update(now: number, dt: number) {
  for (const p of list()) {
    if (drag?.key === p.view.key) continue;
    if (p.view.state === "celebrating" && isGrounded(p.body, bounds) && now >= p.hopUntil) {
      p.body.vy = -420;
      p.hopUntil = now + 900;
    }
    stepBody(p.body, dt, bounds);
    wander(p, now, dt);
    if (p.bubble && now > p.bubble.until) p.bubble = null;
  }
}

function isActive(): boolean {
  if (drag) return true;
  return list().some((p) => !isGrounded(p.body, bounds) || p.targetX != null);
}

function drawBubble(p: Pet) {
  if (!p.bubble) return;
  ctx.font = "11px 'Segoe UI', sans-serif";
  const lines = p.bubble.lines;
  const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + 16;
  const h = lines.length * 14 + 10;
  const x = Math.max(4, Math.min(bounds.w - w - 4, p.body.x + SIZE / 2 - w / 2));
  const y = p.body.y - h - 8 >= 0 ? p.body.y - h - 8 : p.body.y + SIZE + 8;
  ctx.fillStyle = "rgba(24,24,28,0.94)";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fill();
  lines.forEach((l, i) => {
    ctx.fillStyle = i === 0 ? "#ffffff" : i === 1 ? "#c9c9d1" : "#f5c542";
    ctx.fillText(l, x + 8, y + 15 + i * 14);
  });
  dirty.push([x - 2, y - 2, w + 4, h + 4]);
}

function draw(nowMs: number) {
  const now = performance.now();
  const dt = lastDraw ? now - lastDraw : 1000 / FPS_IDLE;
  lastDraw = now;
  update(now, dt);

  // limpa só o que foi desenhado no quadro anterior (a janela tem o tamanho da tela)
  for (const [x, y, w, h] of dirty) ctx.clearRect(x, y, w, h);
  dirty = [];

  for (const p of list()) {
    const held = drag?.key === p.view.key;
    const state = held ? "waiting" : p.view.state;
    const frame = held ? Math.floor(nowMs / 120) % 2 : frameAt(state, nowMs);
    const hop = p.targetX != null ? Math.abs(Math.sin(nowMs / 140)) * 3 : 0;
    const x = Math.round(p.body.x);
    const y = Math.round(p.body.y - hop);
    const grid = buildFrame(p.view.character, state, frame, p.view.costume);
    const palette = paletteFor(p.view.character, p.view.color);
    ctx.save();
    if (p.facing === 1) {
      ctx.translate(x + SIZE, y);
      ctx.scale(-1, 1);
      drawGrid(ctx, grid, 0, 0, SCALE, palette);
    } else {
      drawGrid(ctx, grid, x, y, SCALE, palette);
    }
    ctx.restore();
    dirty.push([x - 2, y - 6, SIZE + 4, SIZE + 12]);
    if (p.view.overflow) {
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(x + 30, y + 2, 22, 14);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText(`+${p.view.overflow}`, x + 33, y + 13);
    }
  }
  for (const p of list()) drawBubble(p);
}

const loop = new AnimationLoop(draw, () => (isActive() ? FPS_ACTIVE : FPS_IDLE));

// ---- mouse ----

function setInteractive(on: boolean) {
  if (on === interactive) return;
  interactive = on;
  canvas.style.cursor = on ? "grab" : "default";
  setPetInteractive(on);
}

function hitKey(x: number, y: number): string | null {
  const ps = list();
  const i = hitTest(
    ps.map((p) => p.body),
    x,
    y,
    SIZE,
  );
  return i < 0 ? null : ps[i].view.key;
}

function onClick(p: Pet) {
  const now = performance.now();
  if (now - p.lastClickAt < DOUBLE_CLICK_MS) {
    p.lastClickAt = 0;
    openPopup();
    return;
  }
  p.lastClickAt = now;
  p.bubble = { lines: bubbleFor(p), until: now + BUBBLE_MS };
  if (isGrounded(p.body, bounds)) p.body.vy = -380; // pulinho
}

window.addEventListener("pointermove", (e) => {
  if (drag) {
    const p = pets.get(drag.key);
    if (!p) return;
    p.body.x = Math.max(0, Math.min(bounds.w - SIZE, e.clientX - drag.dx));
    p.body.y = Math.max(0, Math.min(bounds.h - SIZE, e.clientY - drag.dy));
    p.body.vx = p.body.vy = 0;
    p.targetX = null;
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > CLICK_MAX_MOVE) drag.moved = true;
    drag.samples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (drag.samples.length > 12) drag.samples.shift();
    return;
  }
  setInteractive(hitKey(e.clientX, e.clientY) != null);
});

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const key = hitKey(e.clientX, e.clientY);
  const p = key ? pets.get(key) : null;
  if (!key || !p) return;
  canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = "grabbing";
  const t = performance.now();
  drag = { key, dx: e.clientX - p.body.x, dy: e.clientY - p.body.y, startX: e.clientX, startY: e.clientY, startT: t, moved: false, samples: [{ x: e.clientX, y: e.clientY, t }] };
  // o pegado vai para o fim da lista: é desenhado por cima e vence o hit-test
  order = [...order.filter((k) => k !== key), key];
});

function endDrag(e: PointerEvent) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  const p = pets.get(d.key);
  if (p) {
    if (!d.moved && performance.now() - d.startT < 600) onClick(p);
    else {
      const v = throwVelocity(d.samples);
      p.body.vx = v.vx;
      p.body.vy = v.vy;
    }
  }
  const over = hitKey(e.clientX, e.clientY) != null;
  setInteractive(over);
  canvas.style.cursor = over ? "grab" : "default";
}
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);
document.addEventListener("mouseleave", () => {
  if (!drag) setInteractive(false);
});
window.addEventListener("resize", resize);

async function init() {
  const first = await getSnapshot();
  settings = await getSettings();
  resize();
  syncPets(buildPets(first));
  loop.start();
  void onSnapshot((s) => syncPets(buildPets(s)));
  void onAlert((a) => {
    if (settings.sounds) playAlertSound(a.kind);
  });
  void onSettings((s) => (settings = s));
}

void init();
