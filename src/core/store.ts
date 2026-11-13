// Armazenamento local em SQLite (node:sqlite): configurações (kv), histórico, tokens por minuto e offsets.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HistoryPoint, Tool } from "../shared/types";

export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS samples (ts INTEGER NOT NULL, tool TEXT NOT NULL, win TEXT NOT NULL, pct REAL NOT NULL);
      CREATE INDEX IF NOT EXISTS samples_ts ON samples(ts);
      CREATE UNIQUE INDEX IF NOT EXISTS samples_uq ON samples(ts,tool,win);
      CREATE TABLE IF NOT EXISTS claude_minutes (minute INTEGER PRIMARY KEY, weighted REAL NOT NULL, tokens INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS file_offsets (path TEXT PRIMARY KEY, offset INTEGER NOT NULL);
    `);
  }

  close(): void {
    this.db.close();
  }

  // ---- configurações ----

  get(key: string): string | null {
    const r = this.db.prepare("SELECT value FROM kv WHERE key=?").get(key) as { value: string } | undefined;
    return r?.value ?? null;
  }

  set(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(key, value);
  }

  getBool(key: string, def: boolean): boolean {
    const v = this.get(key);
    return v == null ? def : v === "1";
  }

  setBool(key: string, value: boolean): void {
    this.set(key, value ? "1" : "0");
  }

  // ---- histórico de uso ----

  addSample(ts: number, tool: Tool, win: string, pct: number): void {
    this.db.prepare("INSERT OR IGNORE INTO samples(ts,tool,win,pct) VALUES(?,?,?,?)").run(ts, tool, win, pct);
  }

  samplesSince(tool: Tool, win: string, since: number): Array<[number, number]> {
    const rows = this.db
      .prepare("SELECT ts,pct FROM samples WHERE tool=? AND win=? AND ts>=? ORDER BY ts")
      .all(tool, win, since) as Array<{ ts: number; pct: number }>;
    return rows.map((r) => [r.ts, r.pct]);
  }

  history(since: number): HistoryPoint[] {
    const rows = this.db.prepare("SELECT ts,tool,win,pct FROM samples WHERE ts>=? ORDER BY ts").all(since) as Array<{
      ts: number;
      tool: string;
      win: string;
      pct: number;
    }>;
    return rows.map((r) => ({ ts: r.ts, tool: r.tool === "codex" ? "codex" : "claude", window: r.win as "5h" | "7d", pct: r.pct }));
  }

  pruneSamples(before: number): void {
    this.db.prepare("DELETE FROM samples WHERE ts<?").run(before);
  }

  // ---- tokens locais do Claude por minuto + posição de leitura dos arquivos ----

  loadMinutes(sinceMinute: number): Array<[number, number, number]> {
    const rows = this.db.prepare("SELECT minute,weighted,tokens FROM claude_minutes WHERE minute>=?").all(sinceMinute) as Array<{
      minute: number;
      weighted: number;
      tokens: number;
    }>;
    return rows.map((r) => [r.minute, r.weighted, r.tokens]);
  }

  saveMinutes(rows: Array<[number, number, number]>): void {
    const st = this.db.prepare(
      "INSERT INTO claude_minutes(minute,weighted,tokens) VALUES(?,?,?) ON CONFLICT(minute) DO UPDATE SET weighted=excluded.weighted, tokens=excluded.tokens",
    );
    this.db.exec("BEGIN");
    try {
      for (const [m, w, t] of rows) st.run(m, w, t);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  pruneMinutes(beforeMinute: number): void {
    this.db.prepare("DELETE FROM claude_minutes WHERE minute<?").run(beforeMinute);
  }

  loadOffsets(): Array<[string, number]> {
    const rows = this.db.prepare("SELECT path,offset FROM file_offsets").all() as Array<{ path: string; offset: number }>;
    return rows.map((r) => [r.path, r.offset]);
  }

  saveOffsets(rows: Array<[string, number]>): void {
    const st = this.db.prepare(
      "INSERT INTO file_offsets(path,offset) VALUES(?,?) ON CONFLICT(path) DO UPDATE SET offset=excluded.offset",
    );
    this.db.exec("BEGIN");
    try {
      for (const [p, o] of rows) st.run(p, o);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
