import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AlertEvent, HistoryPoint, Settings, Snapshot } from "./types";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Unlisten = () => void;

// Fora do Tauri (só no `pnpm dev` no navegador) usa dados de exemplo para poder ver a interface.
async function mock() {
  return import("./mock");
}

export async function getSnapshot(): Promise<Snapshot> {
  if (!inTauri && import.meta.env.DEV) return (await mock()).mockSnapshot();
  return invoke<Snapshot>("get_snapshot");
}

export async function getHistory(days: number): Promise<HistoryPoint[]> {
  if (!inTauri && import.meta.env.DEV) return (await mock()).mockHistory();
  return invoke<HistoryPoint[]>("get_history", { days });
}

export async function getSettings(): Promise<Settings> {
  if (!inTauri && import.meta.env.DEV) return { pet: true, sounds: true, claudeExact: true };
  return invoke<Settings>("get_settings");
}

export async function onSnapshot(cb: (s: Snapshot) => void): Promise<Unlisten> {
  if (!inTauri && import.meta.env.DEV) {
    const m = await mock();
    const t = setInterval(() => cb(m.mockSnapshot()), 5000);
    return () => clearInterval(t);
  }
  return listen<Snapshot>("snapshot", (e) => cb(e.payload));
}

export async function onAlert(cb: (a: AlertEvent) => void): Promise<Unlisten> {
  if (!inTauri) return () => {};
  return listen<AlertEvent>("alert", (e) => cb(e.payload));
}

export async function closeThisWindow(): Promise<void> {
  if (!inTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}
