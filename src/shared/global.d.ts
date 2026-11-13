import type { AlertEvent, HistoryPoint, Settings, Snapshot } from "./types";

type Unsubscribe = () => void;

export interface TokenPetsApi {
  getSnapshot(): Promise<Snapshot>;
  getHistory(days: number): Promise<HistoryPoint[]>;
  getSettings(): Promise<Settings>;
  onSnapshot(cb: (s: Snapshot) => void): Unsubscribe;
  onAlert(cb: (a: AlertEvent) => void): Unsubscribe;
  onSettings(cb: (s: Settings) => void): Unsubscribe;
  closeWindow(): void;
}

declare global {
  interface Window {
    tokenPets?: TokenPetsApi;
  }
}
