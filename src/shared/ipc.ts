import type { AlertEvent, HistoryPoint, Settings, Snapshot } from "./types";

type Unlisten = () => void;

// Fora do Electron (só no `pnpm dev` aberto no navegador) usa dados de exemplo para poder ver a interface.
const useMock = () => !window.tokenPets && import.meta.env.DEV;

async function mock() {
  return import("./mock");
}

function api() {
  if (!window.tokenPets) throw new Error("API do Token Pets indisponível (fora do Electron)");
  return window.tokenPets;
}

export async function getSnapshot(): Promise<Snapshot> {
  if (useMock()) return (await mock()).mockSnapshot();
  return api().getSnapshot();
}

export async function getHistory(days: number): Promise<HistoryPoint[]> {
  if (useMock()) return (await mock()).mockHistory();
  return api().getHistory(days);
}

export async function getSettings(): Promise<Settings> {
  if (useMock()) return { pet: true, sounds: true, claudeExact: true };
  return api().getSettings();
}

export async function onSnapshot(cb: (s: Snapshot) => void): Promise<Unlisten> {
  if (useMock()) {
    const m = await mock();
    const t = setInterval(() => cb(m.mockSnapshot()), 5000);
    return () => clearInterval(t);
  }
  return api().onSnapshot(cb);
}

export async function onAlert(cb: (a: AlertEvent) => void): Promise<Unlisten> {
  return window.tokenPets ? window.tokenPets.onAlert(cb) : () => {};
}

export async function onSettings(cb: (s: Settings) => void): Promise<Unlisten> {
  return window.tokenPets ? window.tokenPets.onSettings(cb) : () => {};
}

export async function closeThisWindow(): Promise<void> {
  window.tokenPets?.closeWindow();
}
