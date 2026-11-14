// Processo principal: bandeja, janelas sob demanda (popup e pet), avisos e IPC.
import { BrowserWindow, Menu, Notification, Tray, app, ipcMain, nativeImage, screen, session } from "electron";
import { join } from "node:path";
import { Store } from "../src/core/store";
import { ICON_SIZE, encodePng, moodFor, renderIcon, tooltip } from "../src/core/trayIcon";
import { nowSecs } from "../src/core/util";
import type { Settings, Snapshot } from "../src/shared/types";
import { Runtime } from "./runtime";

const APP_ID = "dev.eduardoopv.tokenpets";
const POPUP = { w: 380, h: 640 };

app.setAppUserModelId(APP_ID);

// Endurecimento: as janelas só carregam as páginas locais do app. Nada de navegar, abrir janelas novas,
// webviews ou pedir permissões (câmera, microfone, localização etc.).
app.on("web-contents-created", (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (e) => e.preventDefault());
  contents.on("will-attach-webview", (e) => e.preventDefault());
});
// Sem processo de GPU: gasta menos memória e as animações são só pixel art em canvas 2D.
app.disableHardwareAcceleration();

let store: Store;
let runtime: Runtime;
let tray: Tray;
let popup: BrowserWindow | null = null;
let pet: BrowserWindow | null = null;
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

// ---- pet flutuante: janela transparente do tamanho da área útil, sempre no topo ----
// Fica ignorando o mouse (com `forward`, o renderer ainda recebe os movimentos); o renderer avisa
// pelo IPC `pet_interactive` quando o cursor entra ou sai de um boneco.

function placePet(win: BrowserWindow): void {
  win.setBounds(screen.getPrimaryDisplay().workArea);
}

function syncPet(): void {
  if (!store.getBool("pet_enabled", false)) {
    if (pet && !pet.isDestroyed()) pet.close();
    return;
  }
  if (pet && !pet.isDestroyed()) return;
  const win = new BrowserWindow({
    ...screen.getPrimaryDisplay().workArea,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences,
  });
  pet = win;
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setAlwaysOnTop(true, "screen-saver");
  placePet(win);
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
      click: toggle("pet_enabled", false, () => syncPet()),
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
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    store = new Store(join(app.getPath("userData"), "token-pets.db"));

    // Primeira execução: iniciar com o Windows (só empacotado, para não registrar o electron.exe de dev).
    const firstRun = !store.getBool("first_run_done", false);
    if (firstRun) {
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true, args: ["--hidden"] });
      store.setBool("pet_enabled", true); // os bonecos são a graça: já aparecem na primeira vez (o menu da bandeja desliga)
      store.setBool("first_run_done", true);
    }

    ipcMain.handle("get_snapshot", () => runtime.latest());
    ipcMain.handle("get_history", (_e, days: number) => store.history(nowSecs() - Math.max(1, Math.min(30, Number(days) || 7)) * 86_400));
    ipcMain.handle("get_settings", () => settings());
    ipcMain.on("close_window", (e) => BrowserWindow.fromWebContents(e.sender)?.close());
    ipcMain.on("open_popup", (e) => {
      if (e.sender === pet?.webContents) openPopup();
    });
    ipcMain.on("pet_interactive", (e, on: boolean) => {
      if (pet && !pet.isDestroyed() && e.sender === pet.webContents) pet.setIgnoreMouseEvents(!on, { forward: true });
    });
    screen.on("display-metrics-changed", () => {
      if (pet && !pet.isDestroyed()) placePet(pet);
    });

    tray = new Tray(nativeImage.createFromBuffer(encodePng(renderIcon(null), ICON_SIZE, ICON_SIZE)));
    tray.setToolTip("Token Pets");
    tray.setContextMenu(buildMenu());
    tray.on("click", togglePopup);

    runtime = new Runtime(store, {
      onSnapshot: (snap, changed) => {
        if (!changed) return;
        broadcast("snapshot", snap);
        updateTray(snap);
      },
      onAlerts: (events) => {
        for (const ev of events) {
          notify(ev.title, ev.body);
          broadcast("alert", ev);
        }
      },
    });
    runtime.start();
    syncPet();
    if (firstRun) openPopup(); // o ícone da bandeja pode ficar escondido em "^": mostra o app logo de cara
  });

  app.on("before-quit", () => runtime?.stop());
}
