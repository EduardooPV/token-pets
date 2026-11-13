// Processo principal: bandeja, janelas sob demanda (popup e pet), avisos e IPC.
import { BrowserWindow, Menu, Notification, Tray, app, ipcMain, nativeImage, screen } from "electron";
import { join } from "node:path";
import { Store } from "../src/core/store";
import { ICON_SIZE, encodePng, moodFor, renderIcon, tooltip } from "../src/core/trayIcon";
import { nowSecs } from "../src/core/util";
import type { Settings, Snapshot } from "../src/shared/types";
import { Runtime } from "./runtime";

const APP_ID = "dev.eduardoopv.tokenpets";
const POPUP = { w: 380, h: 640 };
const PET_SLOT = 56; // deve bater com SLOT em src/pet/main.ts
const PET_HEIGHT = 72;
const PET_MAX_SLOTS = 9;

app.setAppUserModelId(APP_ID);
// Sem processo de GPU: gasta menos memória e as animações são só pixel art em canvas 2D.
app.disableHardwareAcceleration();

let store: Store;
let runtime: Runtime;
let tray: Tray;
let popup: BrowserWindow | null = null;
let pet: BrowserWindow | null = null;
let petSlots = 0;
let trayKey = "";
let trayTip = "";

const preload = join(__dirname, "preload.cjs");

function settings(): Settings {
  return {
    pet: store.getBool("pet_enabled", false),
    sounds: store.getBool("sounds_enabled", false),
    claudeExact: store.getBool("claude_exact", true),
  };
}

function loadPage(win: BrowserWindow, page: "popup" | "pet"): void {
  const dev = process.env.TOKEN_PETS_DEV_URL;
  if (dev) void win.loadURL(`${dev}/${page}.html`);
  else void win.loadFile(join(__dirname, "..", "dist", `${page}.html`));
}

const webPreferences = { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: true };

function broadcast(channel: string, payload: unknown): void {
  for (const w of [popup, pet]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

// ---- popup: criado ao abrir e destruído ao fechar (libera o renderer) ----

function openPopup(): void {
  if (popup && !popup.isDestroyed()) {
    popup.focus();
    return;
  }
  const wa = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    width: POPUP.w,
    height: POPUP.h,
    x: wa.x + wa.width - POPUP.w - 12,
    y: wa.y + wa.height - POPUP.h - 12,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#1b1b1f",
    webPreferences,
  });
  popup = win;
  const openedAt = Date.now();
  win.once("ready-to-show", () => {
    win.show();
    win.focus();
  });
  // fecha ao perder o foco (com uma folga para o clique na bandeja que acabou de abrir)
  win.on("blur", () => {
    if (Date.now() - openedAt > 400) win.close();
  });
  win.on("closed", () => {
    if (popup === win) popup = null;
  });
  loadPage(win, "popup");
}

function togglePopup(): void {
  if (popup && !popup.isDestroyed()) popup.close();
  else openPopup();
}

// ---- pet flutuante: transparente, sempre no topo, ignora o mouse ----

export function petSlotsFor(sessions: number): number {
  return Math.max(2, sessions > 8 ? PET_MAX_SLOTS : sessions);
}

function syncPet(sessionCount: number): void {
  if (!store.getBool("pet_enabled", false)) {
    if (pet && !pet.isDestroyed()) pet.close();
    return;
  }
  const slots = petSlotsFor(sessionCount);
  const w = slots * PET_SLOT + 16;
  const place = (win: BrowserWindow) => {
    const wa = screen.getPrimaryDisplay().workArea;
    win.setBounds({ x: wa.x + wa.width - w - 16, y: wa.y + wa.height - PET_HEIGHT, width: w, height: PET_HEIGHT });
  };
  if (pet && !pet.isDestroyed()) {
    if (slots !== petSlots) {
      petSlots = slots;
      place(pet);
    }
    return;
  }
  const win = new BrowserWindow({
    width: w,
    height: PET_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences,
  });
  pet = win;
  petSlots = slots;
  win.setIgnoreMouseEvents(true);
  win.setAlwaysOnTop(true, "screen-saver");
  place(win);
  win.once("ready-to-show", () => win.showInactive());
  win.on("closed", () => {
    if (pet === win) pet = null;
  });
  loadPage(win, "pet");
}

// ---- bandeja ----

function updateTray(snap: Snapshot): void {
  const maxPct = (u: Snapshot["claude"]) => {
    const v = [u.fiveHour, u.weekly].filter((l) => l && !l.renewed).map((l) => l!.usedPercent);
    return v.length ? Math.max(...v) : null;
  };
  const all = [maxPct(snap.claude), maxPct(snap.codex)].filter((p): p is number => p != null);
  const pct = all.length ? Math.max(...all) : null;
  const key = `${pct == null ? -1 : Math.floor(pct / 4)}|${moodFor(pct)}`;
  if (key !== trayKey) {
    trayKey = key;
    tray.setImage(nativeImage.createFromBuffer(encodePng(renderIcon(pct), ICON_SIZE, ICON_SIZE)));
  }
  const f = (l: Snapshot["claude"]["fiveHour"]) => (l && !l.renewed ? l.usedPercent : null);
  const tip = tooltip([
    ["Claude", f(snap.claude.fiveHour), f(snap.claude.weekly)],
    ["Codex", f(snap.codex.fiveHour), f(snap.codex.weekly)],
  ]);
  if (tip !== trayTip) {
    trayTip = tip;
    tray.setToolTip(tip);
  }
}

function buildMenu(): Menu {
  const s = settings();
  const toggle = (key: string, def: boolean, after?: () => void) => () => {
    store.setBool(key, !store.getBool(key, def));
    after?.();
    broadcast("settings", settings());
    tray.setContextMenu(buildMenu());
  };
  return Menu.buildFromTemplate([
    { label: "Abrir", click: openPopup },
    {
      label: "Pet flutuante",
      type: "checkbox",
      checked: s.pet,
      click: toggle("pet_enabled", false, () => syncPet(runtime.latest()?.sessions.length ?? 0)),
    },
    { label: "Sons", type: "checkbox", checked: s.sounds, click: toggle("sounds_enabled", false) },
    {
      label: "% exato do Claude",
      type: "checkbox",
      checked: s.claudeExact,
      click: toggle("claude_exact", true, () => {
        runtime.wakeApi();
        runtime.refresh();
      }),
    },
    {
      label: "Iniciar com o Windows",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      enabled: app.isPackaged, // em dev registraria o electron.exe, então fica desabilitado
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, args: ["--hidden"] });
        tray.setContextMenu(buildMenu());
      },
    },
    { type: "separator" },
    { label: "Sair", click: () => app.quit() },
  ]);
}

function notify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body }).show();
}

// ---- ciclo de vida ----

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", openPopup);
  // O app vive na bandeja: fechar o popup ou o pet não encerra o processo.
  app.on("window-all-closed", () => {});

  void app.whenReady().then(() => {
    store = new Store(join(app.getPath("userData"), "token-pets.db"));

    // Primeira execução: iniciar com o Windows (só empacotado, para não registrar o electron.exe de dev).
    if (!store.getBool("first_run_done", false)) {
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true, args: ["--hidden"] });
      store.setBool("first_run_done", true);
    }

    ipcMain.handle("get_snapshot", () => runtime.latest());
    ipcMain.handle("get_history", (_e, days: number) => store.history(nowSecs() - Math.max(1, Math.min(30, Number(days) || 7)) * 86_400));
    ipcMain.handle("get_settings", () => settings());
    ipcMain.on("close_window", (e) => BrowserWindow.fromWebContents(e.sender)?.close());

    tray = new Tray(nativeImage.createFromBuffer(encodePng(renderIcon(null), ICON_SIZE, ICON_SIZE)));
    tray.setToolTip("Token Pets");
    tray.setContextMenu(buildMenu());
    tray.on("click", togglePopup);

    runtime = new Runtime(store, {
      onSnapshot: (snap, changed) => {
        if (!changed) return;
        broadcast("snapshot", snap);
        updateTray(snap);
        syncPet(snap.sessions.length);
      },
      onAlerts: (events) => {
        for (const ev of events) {
          notify(ev.title, ev.body);
          broadcast("alert", ev);
        }
      },
    });
    runtime.start();
  });

  app.on("before-quit", () => runtime?.stop());
}
