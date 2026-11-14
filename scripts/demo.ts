// Demonstração reproduzível: páginas reais + eventos de mouse, fixtures e relógio virtual a 60 Hz.
// Cada quadro é lido do canvas e enviado ao FFmpeg; não depende do MediaRecorder/offscreen em tempo real.
import { app, BrowserWindow, ipcMain } from "electron";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { mockHistory, mockSnapshot } from "../src/shared/mock";
import type { Snapshot } from "../src/shared/types";

const root = resolve(".");
const out = join(root, "release/qa/demo");
mkdirSync(out, { recursive: true });
mkdirSync(join(root, "docs/media"), { recursive: true });
app.setPath("userData", join(out, "profile"));
const FPS = 60;
const SECONDS = 36;
const epoch = Date.parse("2026-11-14T12:00:00-03:00");
let snapshot = mockSnapshot();
snapshot.codex.weekly!.usedPercent = 54;
const offset = Math.floor(epoch / 1000) - snapshot.updatedAt;
snapshot.updatedAt += offset;
for (const tool of [snapshot.claude, snapshot.codex]) {
  for (const limit of [tool.fiveHour, tool.weekly]) {
    if (!limit) continue;
    limit.readAt += offset;
    if (limit.resetsAt != null) limit.resetsAt += offset;
    if (limit.projectedExhaustAt != null) limit.projectedExhaustAt += offset;
  }
}
let panelOpened = false;
let clicks = 0;
let pet: BrowserWindow;
let panel: BrowserWindow;
const errors: string[] = [];

const clock = `
  window.demoBase = performance.now() + 1000;
  let time = demoBase, serial = 0, callbacks = new Map();
  const epoch = ${epoch};
  performance.now = () => time;
  Date.now = () => epoch + time;
  Math.random = () => 0.5;
  window.requestAnimationFrame = cb => { callbacks.set(++serial, cb); return serial; };
  window.cancelAnimationFrame = id => callbacks.delete(id);
  window.demoStep = t => {
    time = t;
    const batch = [...callbacks.values()]; callbacks.clear();
    for (const cb of batch) cb(t);
  };
  void 0;
`;

async function windowFor(page: "pet" | "popup") {
  console.log(`Carregando ${page}`);
  const win = new BrowserWindow({ width: page === "pet" ? 1000 : 380, height: page === "pet" ? 540 : 760,
    frame: false, show: false, transparent: page === "pet", backgroundColor: page === "pet" ? "#00000000" : "#1b1b1f",
    webPreferences: { preload: join(root, "dist-electron/preload.cjs"), sandbox: true, contextIsolation: true,
      nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  win.webContents.on("console-message", (event) => { if (event.level === "error") errors.push(event.message); });
  await win.loadFile(join(root, `dist/${page}.html`));
  win.webContents.debugger.attach("1.3");
  await win.webContents.executeJavaScript(clock);
  console.log(`Página ${page} carregada`);
  return win;
}

async function mouse(type: "mouseMoved" | "mousePressed" | "mouseReleased", x: number, y: number, count = 1) {
  await pet.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : count,
  });
}

async function click(x: number, y: number) {
  await mouse("mouseMoved", x, y);
  await mouse("mousePressed", x, y);
  await mouse("mouseReleased", x, y);
  clicks++;
}

async function publish(next: Snapshot) {
  snapshot = next;
  for (const win of [pet, panel]) win.webContents.send("snapshot", snapshot);
  // A barreira aguarda o processamento do IPC antes do próximo quadro virtual.
  await Promise.all([pet, panel].map((win) => win.webContents.executeJavaScript("Promise.resolve()")));
}

async function main() {
  const ffmpeg = spawnSync("ffmpeg", ["-version"], { windowsHide: true, stdio: "ignore" });
  if (ffmpeg.error || ffmpeg.status !== 0) throw new Error("Instale o FFmpeg e disponibilize ffmpeg no PATH para gerar o vídeo.");
  await app.whenReady();
  ipcMain.handle("get_snapshot", () => snapshot);
  ipcMain.handle("get_history", () => mockHistory().map((p) => ({ ...p, ts: p.ts + offset })));
  ipcMain.handle("get_settings", () => ({ pet: true, sounds: false, claudeExact: false }));
  ipcMain.on("pet_interactive", () => {});
  ipcMain.on("open_popup", () => { panelOpened = true; });
  ipcMain.on("close_window", () => {});
  [pet, panel] = await Promise.all([windowFor("pet"), windowFor("popup")]);
  // Espera só a inicialização assíncrona das páginas; os quadros são controlados abaixo.
  await new Promise((r) => setTimeout(r, 200));
  for (let i = 0; i < 60; i++) await Promise.all([pet, panel].map((win) => win.webContents.executeJavaScript(`demoStep(demoBase + ${i * 1000 / FPS})`)));
  console.log("Relógios iniciados");
  await pet.webContents.executeJavaScript(`
    window.demoCanvas = document.createElement('canvas');
    demoCanvas.width = 1600; demoCanvas.height = 900;
    window.demoContext = demoCanvas.getContext('2d');
    window.demoPanel = new Image();
    window.demoPointer = {x: 640, y: 380};
    window.demoRing = -100;
    window.demoRender = (time, title, subtitle, opened) => {
      const c = demoContext, source = document.getElementById('pet');
      c.fillStyle = '#15151b'; c.fillRect(0, 0, 1600, 900);
      c.fillStyle = '#f1f0f5'; c.font = 'bold 32px Segoe UI'; c.fillText('Token Pets', 28, 50);
      c.fillStyle = '#aaa8b6'; c.font = '18px Segoe UI'; c.fillText('Simulação com dados de exemplo · interface real · 60 FPS', 28, 80);
      c.drawImage(demoPanel, 24, 110, 380, 760);
      if (opened && time >= 13 && time < 16) {
        c.strokeStyle = '#f5c542'; c.lineWidth = 3; c.strokeRect(22, 108, 384, 764);
        c.fillStyle = '#46be78'; c.font = '18px Segoe UI'; c.fillText('✓ Painel aberto pelo duplo clique', 450, 215);
      }
      c.fillStyle = '#f5c542'; c.font = 'bold 32px Segoe UI'; c.fillText(title, 450, 150);
      c.fillStyle = '#d0ced9'; c.font = '21px Segoe UI'; c.fillText(subtitle, 450, 185);
      c.fillStyle = '#202029'; c.fillRect(440, 225, 1140, 616);
      c.imageSmoothingEnabled = false;
      c.drawImage(source, 440, 225, 1140, 616);
      c.fillStyle = '#42414e'; c.fillRect(440, 839, 1140, 2);
      c.fillStyle = '#aaa8b6'; c.font = '16px Segoe UI'; c.fillText('Área de trabalho', 454, 866);
      const x = 440 + demoPointer.x * 1.14, y = 225 + demoPointer.y * 616 / 540;
      const age = time - demoRing;
      if (age >= 0 && age < .55) {
        c.strokeStyle = 'rgba(245,197,66,' + (1-age/.55) + ')'; c.lineWidth = 4;
        c.beginPath(); c.arc(x, y, 12 + age * 55, 0, Math.PI * 2); c.stroke();
      }
      c.save(); c.translate(x, y); c.fillStyle = '#fff'; c.strokeStyle = '#111'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 24); c.lineTo(6, 18); c.lineTo(12, 29); c.lineTo(17, 27); c.lineTo(11, 16); c.lineTo(20, 15); c.closePath(); c.fill(); c.stroke(); c.restore();
      c.fillStyle = '#3c3b48'; c.fillRect(450, 887, 1130, 3);
      c.fillStyle = '#f5c542'; c.fillRect(450, 887, 1130 * time / ${SECONDS}, 3);
      return demoCanvas.toDataURL('image/png').split(',')[1];
    };
    void 0;
  `);
  async function panelImage() {
    // capturePage lê o compositor; dá tempo para ele pintar as mudanças de DOM recebidas por IPC.
    await new Promise((r) => setTimeout(r, 60));
    const png = (await panel.webContents.capturePage()).toDataURL();
    await pet.webContents.executeJavaScript(`new Promise(r => {demoPanel.onload = () => r(true); demoPanel.src = ${JSON.stringify(png)};})`);
  }
  await panelImage();
  const encoder = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS),
    "-i", "pipe:0", "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    join(root, "docs/media/demonstracao.mp4")], { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  let encodingError = "";
  encoder.stderr.on("data", (data) => { encodingError += data.toString(); });
  const encodingDone = once(encoder, "close");
  let pointer = { x: 640, y: 380 };
  let currentChapter = "";
  const captures = new Set([90, 150, 300, 450, 690, 900, 1200, 1500, 1740, 1980]);

  for (let frame = 0; frame < FPS * SECONDS; frame++) {
    const t = frame / FPS;
    let title = "Seus agentes, ao vivo";
    let subtitle = "Claude e Codex com nomes, cores e acessórios próprios.";
    if (t >= 1.5 && t < 4) { title = "Clique para conhecer seu agente"; subtitle = "Nome, estado, tokens e personalidade — com um pulinho de resposta."; }
    else if (t >= 4 && t < 8) { title = "Arraste para onde quiser"; subtitle = "O pet acompanha o cursor. Soltou? A gravidade faz o resto."; }
    else if (t >= 8 && t < 12) { title = "Dê impulso e arremesse"; subtitle = "Movimento, queda, quique e atrito em vez de uma posição fixa."; }
    else if (t >= 12 && t < 16) { title = "Dois cliques abrem o painel"; subtitle = "Veja os limites de cinco horas, da semana e o histórico de uso."; }
    else if (t >= 16 && t < 20) { title = "Cada agente tem sua função"; subtitle = "Revisão, segurança, exploração e Codex — todos com uma identidade."; }
    else if (t >= 20 && t < 24) { title = "Perto do limite? Eles sentem"; subtitle = "A partir de 80%, os pets ficam cansados; com 95%, exaustos."; }
    else if (t >= 24 && t < 28) { title = "Limite renovado: comemoração!"; subtitle = "Os mascotes pulam quando a janela de uso é renovada."; }
    else if (t >= 28 && t < 32) { title = "Sem sessões? Hora de descansar"; subtitle = "Claude e Codex dormem enquanto não há agentes ativos."; }
    else if (t >= 32) { title = "Sua área de trabalho continua livre"; subtitle = "Fora dos bonecos, os cliques passam para o aplicativo de baixo."; }
    if (title !== currentChapter) { currentChapter = title; console.log(`${t.toFixed(1)}s: ${title}`); }

    // Eventos passam pelo mecanismo de entrada do Chromium e pelos handlers originais do app.
    if (frame === 90) { pointer = { x: 724, y: 500 }; await click(pointer.x, pointer.y); }
    if (frame === 240) { pointer = { x: 724, y: 500 }; await mouse("mouseMoved", pointer.x, pointer.y); await mouse("mousePressed", pointer.x, pointer.y); }
    if (frame > 240 && frame <= 420) {
      const p = (frame - 240) / 180;
      pointer = { x: 724 - 390 * p, y: 500 - Math.sin(p * Math.PI / 2) * 260 };
      await mouse("mouseMoved", pointer.x, pointer.y);
    }
    if (frame === 420) await mouse("mouseReleased", pointer.x, pointer.y);
    // Recarrega só a cena antes da segunda interação para ter posições iniciais reproduzíveis.
    if (frame === 480 || frame === 720) {
      await publish({ ...snapshot, sessions: snapshot.sessions.map((s) => ({ ...s, id: `${s.id}-${frame}` })) });
    }
    if (frame === 540) { pointer = { x: 724, y: 500 }; await mouse("mouseMoved", pointer.x, pointer.y); await mouse("mousePressed", pointer.x, pointer.y); }
    if (frame > 540 && frame <= 600) {
      const p = (frame - 540) / 60;
      pointer = { x: 724 - p * p * 520, y: 500 - p * p * 280 };
      await mouse("mouseMoved", pointer.x, pointer.y);
    }
    if (frame === 600) await mouse("mouseReleased", pointer.x, pointer.y);
    if (frame === 780 || frame === 788) { pointer = { x: 724, y: 500 }; await click(pointer.x, pointer.y); }
    if (frame === 810 && !panelOpened) throw new Error("O duplo clique não abriu o painel na demonstração");
    if (frame === 960) { pointer = { x: 784, y: 500 }; await click(pointer.x, pointer.y); }
    if (frame === 1060) { pointer = { x: 896, y: 500 }; await click(pointer.x, pointer.y); }
    if (frame === 1200 || frame === 1320) {
      await publish({ ...snapshot, claude: { ...snapshot.claude, fiveHour: { ...snapshot.claude.fiveHour!, usedPercent: frame === 1200 ? 84 : 97 } },
        codex: { ...snapshot.codex, weekly: { ...snapshot.codex.weekly!, usedPercent: frame === 1200 ? 85 : 98 } } });
      await panelImage();
    }
    if (frame === 1440) {
      await publish({ ...snapshot, claude: { ...snapshot.claude, fiveHour: { ...snapshot.claude.fiveHour!, usedPercent: 0, renewed: true } },
        codex: { ...snapshot.codex, weekly: { ...snapshot.codex.weekly!, usedPercent: 0, renewed: true } } });
      await panelImage();
    }
    if (frame === 1680) {
      await publish({ ...snapshot, sessions: [], claude: { ...snapshot.claude, fiveHour: { ...snapshot.claude.fiveHour!, usedPercent: 12, renewed: false } },
        codex: { ...snapshot.codex, weekly: { ...snapshot.codex.weekly!, usedPercent: 20, renewed: false } } });
      await panelImage();
    }
    if (frame === 1920) { pointer = { x: 450, y: 330 }; await click(pointer.x, pointer.y); }
    if ([90, 780, 788, 960, 1060, 1920].includes(frame)) await pet.webContents.executeJavaScript(`demoRing = ${t}`);
    await Promise.all([pet, panel].map((win) => win.webContents.executeJavaScript(`demoStep(demoBase + ${1000 + frame * 1000 / FPS})`)));
    if (frame % 60 === 0 && frame >= 780 && frame < 960) await panelImage();
    const data: string = await pet.webContents.executeJavaScript(`demoPointer = ${JSON.stringify(pointer)}; demoRender(${t}, ${JSON.stringify(title)}, ${JSON.stringify(subtitle)}, ${panelOpened})`);
    const png = Buffer.from(data, "base64");
    if (captures.has(frame)) writeFileSync(join(out, `frame-${frame}.png`), png);
    if (frame === 300) writeFileSync(join(root, "docs/media/demonstracao.png"), png);
    if (!encoder.stdin.write(png)) await once(encoder.stdin, "drain");
  }
  encoder.stdin.end();
  const [code] = await encodingDone;
  if (code !== 0) throw new Error(`FFmpeg falhou (${code}): ${encodingError}`);
  if (errors.length) throw new Error(errors.join("\n"));
  writeFileSync(join(out, "report.json"), JSON.stringify({ seconds: SECONDS, fps: FPS, frames: FPS * SECONDS,
    clicks, panelOpened, errors, method: "Interface real com relógio virtual e captura de cada quadro; dados de exemplo." }, null, 2));
  console.log(`Vídeo pronto: ${SECONDS}s, ${FPS} FPS, ${FPS * SECONDS} quadros.`);
  app.quit();
}

void main().catch((error) => { console.error(error); app.exit(1); });
