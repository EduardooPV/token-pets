// Ícone da bandeja desenhado em código: anel com o maior % de uso e um rostinho com humor.
import { deflateSync } from "node:zlib";

export const ICON_SIZE = 32;
export type Mood = "happy" | "tired" | "exhausted";

export function moodFor(pct: number | null): Mood {
  if (pct != null && pct >= 95) return "exhausted";
  if (pct != null && pct >= 80) return "tired";
  return "happy";
}

function ringColor(pct: number): [number, number, number] {
  if (pct >= 95) return [229, 72, 77];
  if (pct >= 80) return [245, 166, 35];
  return [70, 190, 120];
}

/** RGBA ICON_SIZE×ICON_SIZE. `pct` null = sem dados (anel cinza). */
export function renderIcon(pct: number | null): Uint8Array {
  const buf = new Uint8Array(ICON_SIZE * ICON_SIZE * 4);
  const put = (x: number, y: number, c: [number, number, number, number]) => {
    if (x < 0 || y < 0 || x >= ICON_SIZE || y >= ICON_SIZE) return;
    buf.set(c, (y * ICON_SIZE + x) * 4);
  };
  const c = (ICON_SIZE - 1) / 2;
  const fraction = pct == null ? 0 : Math.max(0, Math.min(1, pct / 100));
  const fill = pct == null ? ([120, 120, 120] as const) : ringColor(pct);
  for (let y = 0; y < ICON_SIZE; y++) {
    for (let x = 0; x < ICON_SIZE; x++) {
      const dx = x - c;
      const dy = y - c;
      const r = Math.hypot(dx, dy);
      if (r >= 11.5 && r <= 15.5) {
        let a = Math.atan2(dx, -dy) / (2 * Math.PI); // a partir do topo, sentido horário
        if (a < 0) a += 1;
        put(x, y, a <= fraction ? [fill[0], fill[1], fill[2], 255] : [90, 90, 90, 150]);
      } else if (r < 10) {
        put(x, y, [217, 119, 87, 255]);
      }
    }
  }
  const eye: [number, number, number, number] = [38, 38, 38, 255];
  const mood = moodFor(pct);
  if (mood === "exhausted") {
    for (const [ex, ey] of [[11, 12], [20, 12]]) {
      for (let d = 0; d < 3; d++) {
        put(ex + d, ey + d, eye);
        put(ex + 2 - d, ey + d, eye);
      }
    }
  } else {
    for (const [ex, ey] of [[12, 13], [19, 13]]) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) put(ex + dx, ey + dy, eye);
  }
  const mouth: Record<Mood, Array<[number, number]>> = {
    happy: [[12, 19], [13, 20], [14, 20], [15, 20], [16, 20], [17, 20], [18, 20], [19, 19]],
    tired: [[13, 20], [14, 20], [15, 20], [16, 20], [17, 20], [18, 20]],
    exhausted: [[12, 21], [13, 20], [14, 19], [15, 19], [16, 19], [17, 19], [18, 20], [19, 21]],
  };
  for (const [x, y] of mouth[mood]) put(x, y, eye);
  return buf;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Codifica RGBA em PNG (sem dependências), para o `nativeImage` do Electron. */
export function encodePng(rgba: Uint8Array, w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export function tooltip(parts: Array<[string, number | null, number | null]>): string {
  const fmt = (v: number | null) => (v == null ? "--" : `${Math.round(v)}%`);
  return parts.length ? parts.map(([n, h5, wk]) => `${n}: 5h ${fmt(h5)} · sem ${fmt(wk)}`).join("\n") : "Token Pets";
}
