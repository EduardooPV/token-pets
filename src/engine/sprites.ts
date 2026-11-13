// Pixel art original, desenhada em código (grade 16x16). Dois personagens, 7 estados e fantasias.

export const GRID = 16;

export type Character = "claude" | "codex";
export type PetState = "idle" | "working" | "waiting" | "tired" | "exhausted" | "sleeping" | "celebrating";
export type Costume = "none" | "magnifier" | "shield" | "pen" | "map" | "generic";

export type Grid = string[][]; // "" = transparente

export const PALETTE: Record<string, string> = {
  O: "#d97757",
  D: "#964e34",
  B: "#5b6cf0",
  b: "#3a49bf",
  L: "#c7ceff",
  K: "#262626",
  W: "#ffffff",
  H: "#f8bba0",
  R: "#e5484d",
  Y: "#f5c542",
  G: "#46be78",
  S: "#8ecae6",
  P: "#ff8fc7",
  T: "#7a5230",
  M: "#f3e2b3",
  g: "#9aa0a6",
  N: "#1b2140",
  C: "#5ef2d0",
};

function newGrid(): Grid {
  return Array.from({ length: GRID }, () => Array<string>(GRID).fill(""));
}

function set(g: Grid, x: number, y: number, k: string) {
  if (x >= 0 && y >= 0 && x < GRID && y < GRID) g[y][x] = k;
}

function stamp(g: Grid, rows: string[], ox: number, oy: number) {
  rows.forEach((row, dy) =>
    [...row].forEach((ch, dx) => {
      if (ch !== "." && ch !== " ") set(g, ox + dx, oy + dy, ch);
    }),
  );
}

function shift(g: Grid, dy: number): Grid {
  if (dy === 0) return g;
  const out = newGrid();
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) if (g[y][x]) set(out, x, y + dy, g[y][x]);
  return out;
}

const BODY: Record<Character, string[]> = {
  claude: [
    "..OOOOOOOO..",
    ".OOOOOOOOOO.",
    "OOOOOOOOOOOO",
    "OOOOOOOOOOOO",
    "OOOOOOOOOOOO",
    "OOOOOOOOOOOO",
    "OOOOOOOOOOOO",
    "OOOOOOOOOOOO",
    ".OOOOOOOOOO.",
    "..OOOOOOOO..",
    "..OO....OO..",
    "..DD....DD..",
  ],
  codex: [
    ".....Y......",
    "BBBBBBBBBBBB",
    "BNNNNNNNNNNB",
    "BNNNNNNNNNNB",
    "BNNNNNNNNNNB",
    "BNNNNNNNNNNB",
    "BNNNNNNNNNNB",
    "BNNNNNNNNNNB",
    "BNNNNNNNNNNB",
    "BBBBBBBBBBBB",
    "....bbbb....",
    "..bbbbbbbb..",
  ],
};
// o corpo do claudezinho começa na linha 2; o do codexzinho tem antena e começa na linha 1
const BODY_Y: Record<Character, number> = { claude: 2, codex: 1 };

type Pt = [number, number];

// cor do "rosto": o claudezinho tem olhos escuros; o codexzinho é um monitor com rosto brilhante na tela
let INK = "K";

function pixels(g: Grid, pts: Pt[], k: string) {
  for (const [x, y] of pts) set(g, x, y, k);
}

function eyesOpen(g: Grid, dx = 0) {
  stamp(g, [INK+INK], 5 + dx, 5);
  stamp(g, [INK+INK], 5 + dx, 6);
  stamp(g, [INK+INK], 9 + dx, 5);
  stamp(g, [INK+INK], 9 + dx, 6);
}

function eyesLine(g: Grid, y = 6) {
  stamp(g, [INK+INK], 5, y);
  stamp(g, [INK+INK], 9, y);
}

function drawFace(g: Grid, state: PetState, frame: number) {
  switch (state) {
    case "idle":
      if (frame === 1) eyesLine(g);
      else eyesOpen(g);
      pixels(g, [[6, 8], [7, 9], [8, 9], [9, 8]], INK);
      break;
    case "working":
      eyesLine(g);
      pixels(g, [[7, 8], [8, 8]], INK);
      break;
    case "waiting":
      eyesOpen(g, 1);
      pixels(g, [[7, 8], [8, 8]], INK);
      break;
    case "tired":
      eyesLine(g);
      pixels(g, [[7, 8], [8, 8], [9, 8]], INK);
      break;
    case "exhausted":
      for (const ox of [5, 9]) pixels(g, [[ox, 5], [ox + 2, 5], [ox + 1, 6], [ox, 7], [ox + 2, 7]], INK);
      pixels(g, [[6, 9], [7, 8], [8, 9], [9, 8]], INK);
      if (frame === 1) pixels(g, [[8, 10]], "R");
      break;
    case "sleeping":
      eyesLine(g);
      pixels(g, [[7, 8], [8, 8]], INK);
      break;
    case "celebrating":
      for (const ox of [5, 9]) pixels(g, [[ox, 6], [ox + 1, 5], [ox + 2, 6]], INK);
      pixels(g, [[7, 8], [8, 8], [7, 9], [8, 9]], INK);
      pixels(g, [[7, 9], [8, 9]], "R");
      break;
  }
}

function drawExtras(g: Grid, state: PetState, frame: number) {
  switch (state) {
    case "working":
      [5, 8, 11].forEach((x, i) => set(g, x, 0, i === frame % 3 ? "Y" : "g"));
      break;
    case "waiting":
      if (frame === 0) {
        stamp(g, ["KKK", "..K", ".K.", "...", ".K."], 12, 0);
      }
      break;
    case "tired":
      pixels(g, frame === 0 ? [[14, 5], [14, 6]] : [[14, 6], [14, 7]], "S");
      break;
    case "sleeping":
      if (frame === 0) stamp(g, ["PPP", ".P.", "PPP"], 11, 2);
      else stamp(g, ["PP", "P.", "PP"], 12, 0);
      break;
    case "celebrating": {
      const a: [number, number, string][] = [[1, 1, "R"], [14, 2, "Y"], [3, 0, "G"], [12, 1, "P"], [0, 6, "Y"], [15, 7, "R"]];
      for (const [x, y, k] of a) set(g, x, y + frame * 2, k);
      break;
    }
    default:
      break;
  }
}

export function drawCostume(g: Grid, c: Costume) {
  switch (c) {
    case "magnifier":
      stamp(g, [".SS.", "S..S", "S..S", ".SS."], 11, 8);
      pixels(g, [[14, 12], [15, 13]], "K");
      break;
    case "shield":
      stamp(g, ["SSSS", "SWWS", ".SS."], 6, 10);
      break;
    case "pen":
      pixels(g, [[14, 9]], "K");
      pixels(g, [[13, 10], [12, 11]], "T");
      pixels(g, [[11, 12]], "Y");
      break;
    case "map":
      stamp(g, ["MMMM", "MRRM", "MMRM", "MMMM"], 11, 9);
      break;
    case "generic":
      stamp(g, [".RRRR."], 5, 1);
      stamp(g, ["RRRRRR"], 5, 2);
      break;
    case "none":
      break;
  }
}

const cache = new Map<string, Grid>();

export function buildFrame(character: Character, state: PetState, frame: number, costume: Costume = "none"): Grid {
  const key = `${character}|${state}|${frame}|${costume}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let core = newGrid();
  stamp(core, BODY[character], 2, BODY_Y[character]);
  INK = character === "codex" ? "C" : "K";
  drawFace(core, state, frame);
  drawCostume(core, costume);
  let dy = 0;
  if (state === "idle" || state === "waiting") dy = frame % 2;
  if (state === "working") dy = frame === 1 ? 1 : 0;
  if (state === "sleeping") dy = 1;
  if (state === "celebrating") dy = frame === 0 ? 0 : -1;
  core = shift(core, dy);
  drawExtras(core, state, frame);
  cache.set(key, core);
  return core;
}

export function drawGrid(ctx: CanvasRenderingContext2D, g: Grid, x: number, y: number, scale: number) {
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const k = g[gy][gx];
      if (!k) continue;
      ctx.fillStyle = PALETTE[k] ?? "#ff00ff";
      ctx.fillRect(Math.round(x + gx * scale), Math.round(y + gy * scale), scale, scale);
    }
  }
}

/** Fantasia por tipo de subagente (agentType do .meta.json). */
export function costumeForAgent(agentType: string | null): Costume {
  if (!agentType) return "none";
  const t = agentType.toLowerCase();
  if (t.includes("review") || t.includes("audit")) return "magnifier";
  if (t.includes("security") || t.includes("probe")) return "shield";
  if (t.includes("copy") || t.includes("writer") || t.includes("doc")) return "pen";
  if (t.includes("explor") || t.includes("search") || t.includes("plan")) return "map";
  return "generic";
}
