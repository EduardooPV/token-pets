import "./style.css";
import { AnimationLoop, frameAt } from "../engine/animation";
import { buildPets, type PetView } from "../engine/scene";
import { GRID, buildFrame, drawGrid } from "../engine/sprites";
import { barLevel, formatPercent, limitCaption, projectionText } from "../shared/format";
import { closeThisWindow, getHistory, getSettings, getSnapshot, onAlert, onSettings, onSnapshot } from "../shared/ipc";
import { playAlertSound } from "../shared/sounds";
import type { HistoryPoint, Limit, Settings, Snapshot, Tool, ToolUsage } from "../shared/types";
import { CHART_H, CHART_W, buildChart } from "./chart";

const SCALE = 4; // 16 * 4 = 64px
const app = document.getElementById("app")!;

let snapshot: Snapshot | null = null;
let history: HistoryPoint[] = [];
let settings: Settings = { pet: false, sounds: false, claudeExact: true };
let chartTool: Tool = "claude";
let pets: PetView[] = [];
const canvases = new Map<string, HTMLCanvasElement>();

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function barRow(name: string, l: Limit | null, now: number): string {
  if (!l) {
    return `<div class="row"><div class="top"><span>${name}</span><b>--</b></div><div class="bar empty"><i></i></div><div class="caption">sem dados ainda</div></div>`;
  }
  const pct = l.renewed ? 0 : l.usedPercent;
  const proj = projectionText(l, now);
  return `<div class="row">
    <div class="top"><span>${name}</span><b>${formatPercent(pct)}</b></div>
    <div class="bar"><i class="${barLevel(pct)}" style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>
    <div class="caption">${esc(limitCaption(l, now))}${proj ? ` · <span class="proj">${esc(proj)}</span>` : ""}</div>
  </div>`;
}

function card(u: ToolUsage, title: string, now: number): string {
  const tag = u.tool === "claude" ? (u.calibrated ? "teto calibrado" : "") : (u.plan ?? "");
  return `<section class="card ${u.tool}">
    <h2>${title}<span class="tag">${esc(tag)}</span></h2>
    ${barRow("5 horas", u.fiveHour, now)}
    ${barRow("Semana", u.weekly, now)}
  </section>`;
}

function chartSvg(now: number): string {
  const c = buildChart(history, chartTool, now);
  const guides = c.guides
    .map((g) => `<line x1="26" x2="${CHART_W - 8}" y1="${g.y}" y2="${g.y}" stroke="var(--line)" stroke-dasharray="3 3"/><text x="2" y="${g.y + 3}" font-size="9" fill="var(--muted)">${g.label}</text>`)
    .join("");
  const ticks = c.ticks.map((t) => `<text x="${t.x}" y="${CHART_H - 3}" font-size="9" text-anchor="end" fill="var(--muted)">${t.label}</text>`).join("");
  const color = chartTool === "claude" ? "var(--claude)" : "var(--codex)";
  const lines = c.hasData
    ? `<path d="${c.paths["5h"]}" fill="none" stroke="${color}" stroke-opacity="0.45" stroke-width="1.5"/><path d="${c.paths["7d"]}" fill="none" stroke="${color}" stroke-width="2"/>`
    : `<text x="${CHART_W / 2}" y="${CHART_H / 2}" text-anchor="middle" font-size="11" fill="var(--muted)">o histórico aparece conforme você usa</text>`;
  return `<svg class="chart" viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="none">${guides}${ticks}${lines}</svg>`;
}

function petsHtml(): string {
  if (pets.length === 0) return `<div class="empty-note">Nenhuma sessão ativa</div>`;
  return pets
    .map(
      (p) => `<div class="pet" title="${esc(p.label)}"><canvas width="${GRID * SCALE}" height="${GRID * SCALE}" data-key="${esc(p.key)}"></canvas>${p.overflow ? `<span class="more">+${p.overflow}</span>` : ""}<div class="name">${esc(p.label)}</div></div>`,
    )
    .join("");
}

function render() {
  if (!snapshot) return;
  const now = Math.floor(Date.now() / 1000);
  pets = buildPets(snapshot);
  const exactNote = settings.claudeExact && snapshot.claudeExactError ? `<span class="warn">Claude exato indisponível: ${esc(snapshot.claudeExactError)}</span>` : `<span></span>`;
  app.innerHTML = `
    <header class="drag"><h1>Token Pets</h1><button id="close" title="Fechar (Esc)">✕</button></header>
    <div class="cards">${card(snapshot.claude, "Claude", now)}${card(snapshot.codex, "Codex", now)}</div>
    <div><h3>Agora</h3><div class="pets">${petsHtml()}</div></div>
    <div>
      <div class="chart-head"><h3>Últimos 7 dias</h3>
        <div class="tabs"><button data-tool="claude" class="${chartTool === "claude" ? "on" : ""}">Claude</button><button data-tool="codex" class="${chartTool === "codex" ? "on" : ""}">Codex</button></div>
      </div>
      ${chartSvg(now)}
      <div class="legend"><span><i style="background:var(--muted);opacity:.5"></i>5 horas</span><span><i style="background:var(--muted)"></i>semana</span></div>
    </div>
    <footer>${exactNote}<span>atualizado ${new Date(snapshot.updatedAt * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span></footer>`;
  canvases.clear();
  app.querySelectorAll<HTMLCanvasElement>("canvas[data-key]").forEach((c) => canvases.set(c.dataset.key!, c));
  document.getElementById("close")?.addEventListener("click", () => void closeThisWindow());
  app.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      chartTool = b.dataset.tool as Tool;
      render();
    }),
  );
  draw(Date.now());
}

function draw(nowMs: number) {
  for (const p of pets) {
    const canvas = canvases.get(p.key);
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) continue;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid(ctx, buildFrame(p.character, p.state, frameAt(p.state, nowMs), p.costume), 0, 0, SCALE);
  }
}

const loop = new AnimationLoop(draw);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") void closeThisWindow();
});

async function init() {
  [snapshot, history, settings] = await Promise.all([getSnapshot(), getHistory(7), getSettings()]);
  render();
  loop.start();
  void onSnapshot((s) => {
    snapshot = s;
    render();
  });
  void onAlert((a) => {
    if (settings.sounds) playAlertSound(a.kind);
  });
  void onSettings((s) => (settings = s));
}

void init();
