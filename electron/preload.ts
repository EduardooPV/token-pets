import { contextBridge, ipcRenderer } from "electron";

type Cb<T> = (v: T) => void;

function subscribe<T>(channel: string, cb: Cb<T>): () => void {
  const handler = (_e: unknown, v: T) => cb(v);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("tokenPets", {
  getSnapshot: () => ipcRenderer.invoke("get_snapshot"),
  getHistory: (days: number) => ipcRenderer.invoke("get_history", days),
  getSettings: () => ipcRenderer.invoke("get_settings"),
  onSnapshot: (cb: Cb<unknown>) => subscribe("snapshot", cb),
  onAlert: (cb: Cb<unknown>) => subscribe("alert", cb),
  onSettings: (cb: Cb<unknown>) => subscribe("settings", cb),
  closeWindow: () => ipcRenderer.send("close_window"),
});
