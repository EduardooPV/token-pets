// Testa as páginas reais no Electron com fixtures e grava uma demonstração sem dados pessoais.
import { app, BrowserWindow, ipcMain } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { mockHistory, mockSnapshot } from "../src/shared/mock";

const root = resolve(".");
const out = join(root, "release", "qa");
mkdirSync(out, { recursive: true });
app.setPath("userData", join(out, "profile"));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const snapshot = mockSnapshot();
// Uma carga intermediária deixa visíveis os estados de trabalho dos dois mascotes.
snapshot.codex.weekly!.usedPercent = 54;
let popup: BrowserWindow;
let pet: BrowserWindow;
let interactive = false;
let opened = 0;
const preferences = { preload: join(root, "dist-electron", "preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false };

async function main() {
  await app.whenReady();
  ipcMain.handle("get_snapshot", () => snapshot);
  ipcMain.handle("get_history", () => mockHistory());
  ipcMain.handle("get_settings", () => ({ pet: true, sounds: false, claudeExact: false }));
  ipcMain.on("pet_interactive", (_e, on) => { interactive = on; });
  ipcMain.on("open_popup", () => { opened++; });
  ipcMain.on("close_window", (e) => BrowserWindow.fromWebContents(e.sender)?.hide());
  popup = new BrowserWindow({ width: 380, height: 760, frame: false, show: false, backgroundColor: "#1b1b1f", webPreferences: preferences });
  // Offscreen mantém os eventos de teste isolados do cursor real da pessoa.
  pet = new BrowserWindow({ width: 1000, height: 540, frame: false, transparent: true, show: false, webPreferences: { ...preferences, offscreen: true } });
  const errors: string[] = [];
  for (const win of [popup, pet]) win.webContents.on("console-message", (event) => { if (event.level === "error") errors.push(event.message); });
  await Promise.all([popup.loadFile(join(root, "dist/popup.html")), pet.loadFile(join(root, "dist/pet.html"))]);
  await wait(1000);
  const labels: string[] = await popup.webContents.executeJavaScript("Array.from(document.querySelectorAll('.name'), e => e.textContent)");
  if (labels.length !== 5 || !labels.includes("Revisão do PR")) throw new Error(`Pets não renderizaram: ${labels}`);
  writeFileSync(join(out, "painel.png"), (await popup.webContents.capturePage()).toPNG());
  // Mede os intervalos reais de desenho durante o arraste, além de gravar o canvas a 60 fps.
  await pet.webContents.executeJavaScript(`
    window.qaDraws = [];
    const ctx = document.getElementById('pet').getContext('2d');
    const original = ctx.clearRect.bind(ctx);
    const canvas = document.getElementById('pet');
    const recording = document.createElement('canvas');
    recording.width = canvas.width; recording.height = canvas.height;
    const output = recording.getContext('2d');
    const stream = recording.captureStream(0);
    const track = stream.getVideoTracks()[0];
    let queued = false;
    ctx.clearRect = (...args) => {
      const t = performance.now();
      if (!queued) {
        window.qaDraws.push(t);
        queued = true;
        queueMicrotask(() => {
          queued = false;
          output.fillStyle = '#1b1b1f'; output.fillRect(0, 0, recording.width, recording.height);
          output.drawImage(canvas, 0, 0);
          track.requestFrame();
        });
      }
      return original(...args);
    };
    const chunks = [];
    window.qaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
    window.qaRecording = new Promise(r => {
      qaRecorder.ondataavailable = e => chunks.push(e.data);
      qaRecorder.onstop = async () => r(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())));
    });
    qaRecorder.start();
  `);
  // O primeiro sprite pousa em x=704, y=490; capture-o antes que comece a passear.
  const x = 724, y = 500;
  pet.webContents.sendInputEvent({ type: "mouseMove", x, y });
  await wait(150);
  if (!interactive) throw new Error("Hover não habilitou a interação");
  pet.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  for (let i = 1; i <= 120; i++) {
    pet.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(x - i * 3), y: Math.round(y - Math.sin(i / 120 * Math.PI) * 230) });
    await wait(1000 / 60);
    if (i === 60) {
      const moved = await pet.webContents.executeJavaScript("Array.from(document.getElementById('pet').getContext('2d').getImageData(520, 240, 70, 70).data).some((v, i) => i % 4 === 3 && v > 0)");
      if (!moved) throw new Error("O sprite não acompanhou o arraste");
    }
  }
  pet.webContents.sendInputEvent({ type: "mouseUp", x: x - 360, y, button: "left", clickCount: 1 });
  await wait(700);
  writeFileSync(join(out, "agentes.png"), (await pet.webContents.capturePage()).toPNG());
  // Clique em uma posição nova e conhecida: reload repõe as fixtures e as posições iniciais.
  await pet.webContents.executeJavaScript("qaRecorder.stop()");
  const video: number[] = await pet.webContents.executeJavaScript("qaRecording");
  writeFileSync(join(out, "interacao.webm"), Buffer.from(video));
  const draws: number[] = await pet.webContents.executeJavaScript("qaDraws");
  const unique = draws.filter((t, i) => !i || t - draws[i - 1] > 2);
  const intervals = unique.slice(1).map((t, i) => t - unique[i]).filter((ms) => ms < 100).sort((a, b) => a - b);
  const report = { labels, frames: unique.length, medianFrameMs: intervals[Math.floor(intervals.length / 2)], p95FrameMs: intervals[Math.floor(intervals.length * 0.95)], errors };
  pet.reload();
  await wait(700);
  for (let i = 0; i < 2; i++) {
    pet.webContents.sendInputEvent({ type: "mouseMove", x, y });
    pet.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    pet.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
    await wait(130);
    if (i === 0) writeFileSync(join(out, "agentes.png"), (await pet.webContents.capturePage()).toPNG());
  }
  if (opened !== 1) throw new Error(`Duplo clique não abriu o painel: ${opened}`);
  pet.webContents.sendInputEvent({ type: "mouseMove", x: 10, y: 10 });
  await wait(150);
  if (interactive) throw new Error("Área vazia continuou interceptando cliques");
  if (errors.length) throw new Error(errors.join("\n"));
  writeFileSync(join(out, "report.json"), JSON.stringify({ ...report, doubleClick: true, clickThrough: true }, null, 2));
  console.log(JSON.stringify(report));
  app.quit();
}

void main().catch((error) => { console.error(error); app.exit(1); });
