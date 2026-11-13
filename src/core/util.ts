import { closeSync, openSync, readSync, statSync } from "node:fs";

export const nowSecs = (): number => Math.floor(Date.now() / 1000);

export function fileMtimeSecs(path: string): number | null {
  try {
    return Math.floor(statSync(path).mtimeMs / 1000);
  } catch {
    return null;
  }
}

/** Converte "2026-11-13T00:46:08.451Z" (ou com offset ±HH:MM) em epoch segundos. */
export function parseIso8601(s: string | null | undefined): number | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(s)) return null;
  const t = Date.parse(s.replace(" ", "T"));
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

export function formatIso8601(ts: number): string {
  return new Date(ts * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Posição de leitura de um arquivo JSONL: só avança por linhas completas. */
export class TailState {
  constructor(public offset = 0) {}
}

/**
 * Lê as linhas completas novas desde `state.offset`. Linha parcial no fim fica para a próxima leitura.
 * Se o arquivo encolheu (rotação/truncamento) recomeça do zero. Lança se o arquivo não puder ser aberto.
 */
export function readNewLines(path: string, state: TailState, onLine: (line: string) => void): number {
  const size = statSync(path).size;
  if (size < state.offset) state.offset = 0;
  if (size === state.offset) return 0;
  const fd = openSync(path, "r");
  let count = 0;
  try {
    const chunk = Buffer.alloc(1 << 20);
    let pos = state.offset;
    let carry: Buffer = Buffer.alloc(0);
    for (;;) {
      const n = readSync(fd, chunk, 0, chunk.length, pos);
      if (n === 0) break;
      pos += n;
      const data = carry.length ? Buffer.concat([carry, chunk.subarray(0, n)]) : chunk.subarray(0, n);
      let start = 0;
      let idx: number;
      while ((idx = data.indexOf(10, start)) !== -1) {
        state.offset += idx + 1 - start;
        const line = data.toString("utf8", start, idx).replace(/\r$/, "");
        start = idx + 1;
        if (line) {
          onLine(line);
          count++;
        }
      }
      carry = Buffer.from(data.subarray(start));
    }
  } finally {
    closeSync(fd);
  }
  return count;
}

/** Primeira linha do arquivo, lendo no máximo `max` bytes. */
export function firstLine(path: string, max: number): string | null {
  try {
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(max);
      const n = readSync(fd, buf, 0, max, 0);
      const text = buf.toString("utf8", 0, n);
      const line = text.split("\n", 1)[0];
      return line ? line : null;
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}
