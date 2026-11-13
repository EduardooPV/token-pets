// Gera app-icon.png (512x512) com o claudezinho em pixel art. Uso: node scripts/make-icon.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const G = [
  "................",
  "................",
  "....OOOOOOOO....",
  "...OOOOOOOOOO...",
  "..OOOOOOOOOOOO..",
  "..OOKKOOOOKKOO..",
  "..OOKKOOOOKKOO..",
  "..OOOOOOOOOOOO..",
  "..OOOOOHHOOOOO..",
  "..OOOOOOOOOOOO..",
  "...OOOOOOOOOO...",
  "....OOOOOOOO....",
  "....OO....OO....",
  "....DD....DD....",
  "................",
  "................",
];
const PAL = { O: [217, 119, 87], K: [38, 38, 38], H: [248, 187, 160], D: [150, 78, 52] };
const S = 32, N = 16 * S;
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0;
  for (let x = 0; x < N; x++) {
    const c = PAL[G[Math.floor(y / S)][Math.floor(x / S)]];
    const o = y * (N * 4 + 1) + 1 + x * 4;
    if (c) { raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255; }
  }
}
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync("app-icon.png", Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
console.log("app-icon.png ok");
