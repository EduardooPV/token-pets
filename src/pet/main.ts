// Pet flutuante: janela transparente, sempre no topo, que deixa o clique passar (cursor events ignorados no processo principal).
import { AnimationLoop, frameAt } from "../engine/animation";
import { buildPets, type PetView } from "../engine/scene";
import { GRID, buildFrame, drawGrid } from "../engine/sprites";
import { getSettings, getSnapshot, onAlert, onSettings, onSnapshot } from "../shared/ipc";
import { playAlertSound } from "../shared/sounds";
import type { Settings } from "../shared/types";

const SCALE = 3; // 48px por boneco
const SLOT = 56; // deve bater com PET_SLOT em electron/main.ts
const canvas = document.getElementById("pet") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
let pets: PetView[] = [];
let settings: Settings = { pet: true, sounds: false, claudeExact: true };

function resize() {
  const slots = Math.max(2, pets.length);
  const dpr = window.devicePixelRatio || 1;
  const w = slots * SLOT + 16;
  const h = 72;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
}

function draw(nowMs: number) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  pets.forEach((p, i) => {
    // cada boneco passeia devagar dentro do seu espaço, em fases diferentes
    const wander = Math.sin(nowMs / 2200 + i * 1.7) * 3;
    const walking = p.state === "working" ? Math.sin(nowMs / 160) * 1 : 0;
    const x = 8 + i * SLOT + (SLOT - GRID * SCALE) / 2 + wander;
    drawGrid(ctx, buildFrame(p.character, p.state, frameAt(p.state, nowMs), p.costume), x, 72 - GRID * SCALE - 2 + walking, SCALE);
    if (p.overflow) {
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(x + 30, 2, 22, 14);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText(`+${p.overflow}`, x + 33, 13);
    }
  });
}

const loop = new AnimationLoop(draw);

async function init() {
  const first = await getSnapshot();
  settings = await getSettings();
  pets = buildPets(first);
  resize();
  loop.start();
  void onSnapshot((s) => {
    const before = pets.length;
    pets = buildPets(s);
    if (pets.length !== before) resize();
  });
  void onAlert((a) => {
    if (settings.sounds) playAlertSound(a.kind);
  });
  void onSettings((s) => (settings = s));
}

void init();
