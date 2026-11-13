// Laço do app: watcher de arquivos (debounce), tick, consulta periódica da API do Claude e publicação do estado.
import { watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AlertState, evaluate } from "../src/core/alerts";
import { fetchUsage } from "../src/core/claudeApi";
import { Engine } from "../src/core/engine";
import type { Store } from "../src/core/store";
import { nowSecs } from "../src/core/util";
import type { AlertEvent, Snapshot } from "../src/shared/types";

const DEBOUNCE_MS = 1000;
/** Recalcula o estado sem evento de arquivo (status trabalhando/esperando, reset de janelas). */
const TICK_MS = 15_000;
const API_EVERY_MS = 300_000;

export interface RuntimeHooks {
  onSnapshot(snap: Snapshot, changed: boolean): void;
  onAlerts(events: AlertEvent[]): void;
}

const relevant = (p: string) => p.endsWith(".jsonl") || p.endsWith(".meta.json");

function sameContent(a: Snapshot, b: Snapshot): boolean {
  return JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 });
}

export class Runtime {
  private engine: Engine;
  private prev: Snapshot | null = null;
  private alertState = new AlertState();
  private pending = new Set<string>();
  private debounce: NodeJS.Timeout | null = null;
  private tick: NodeJS.Timeout | null = null;
  private apiTimer: NodeJS.Timeout | null = null;
  private watchers: FSWatcher[] = [];
  private stopped = false;

  constructor(
    private store: Store,
    private hooks: RuntimeHooks,
  ) {
    const home = homedir();
    this.engine = new Engine(store, join(home, ".claude", "projects"), join(home, ".codex", "sessions"), nowSecs());
  }

  latest(): Snapshot | null {
    return this.prev;
  }

  start(): void {
    const { claudeRoot, codexRoot } = this.engine;
    this.engine.initialScan(nowSecs());
    for (const root of [claudeRoot, codexRoot]) {
      try {
        const w = watch(root, { recursive: true }, (_evt, filename) => {
          if (!filename) return;
          const p = join(root, filename.toString());
          if (relevant(p)) this.queue(p);
        });
        w.on("error", () => {});
        this.watchers.push(w);
      } catch {
        /* a pasta pode não existir (ferramenta nunca usada) */
      }
    }
    this.publish();
    this.tick = setInterval(() => this.publish(), TICK_MS);
    void this.pollApi();
  }

  stop(): void {
    this.stopped = true;
    for (const w of this.watchers) w.close();
    if (this.debounce) clearTimeout(this.debounce);
    if (this.tick) clearInterval(this.tick);
    if (this.apiTimer) clearTimeout(this.apiTimer);
  }

  /** Reaplica configurações (ex.: "% exato" ligado/desligado). */
  refresh(): void {
    this.publish();
  }

  /** Consulta a API agora (ao ligar "% exato"). */
  wakeApi(): void {
    if (this.apiTimer) clearTimeout(this.apiTimer);
    void this.pollApi();
  }

  private queue(path: string): void {
    this.pending.add(path);
    this.debounce ??= setTimeout(() => {
      this.debounce = null;
      const now = nowSecs();
      for (const p of this.pending) this.engine.handlePath(p, now);
      this.pending.clear();
      this.engine.flush(now);
      this.publish();
    }, DEBOUNCE_MS);
  }

  private async pollApi(): Promise<void> {
    if (this.stopped) return;
    if (this.store.getBool("claude_exact", true)) {
      try {
        this.engine.setExact({ ok: await fetchUsage(nowSecs()) }, nowSecs());
      } catch (e) {
        this.engine.setExact({ error: e instanceof Error ? e.message : "erro desconhecido" }, nowSecs());
      }
      this.publish();
    }
    this.apiTimer = setTimeout(() => void this.pollApi(), API_EVERY_MS);
  }

  private publish(): void {
    if (this.stopped) return;
    const snap = this.engine.snapshot(nowSecs());
    const events = evaluate(this.prev, snap, this.alertState);
    if (events.length) this.hooks.onAlerts(events);
    const changed = !this.prev || !sameContent(this.prev, snap);
    this.prev = snap;
    this.hooks.onSnapshot(snap, changed);
  }
}
