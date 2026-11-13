import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ICON_SIZE, encodePng, moodFor, renderIcon, tooltip } from "./trayIcon";

const rgb = (b: Uint8Array, x: number, y: number) => Array.from(b.subarray((y * ICON_SIZE + x) * 4, (y * ICON_SIZE + x) * 4 + 3));

describe("trayIcon", () => {
  it("humor por faixa de uso", () => {
    expect(moodFor(null)).toBe("happy");
    expect(moodFor(79.9)).toBe("happy");
    expect(moodFor(80)).toBe("tired");
    expect(moodFor(95)).toBe("exhausted");
  });

  it("tem o tamanho certo e o canto é transparente", () => {
    const b = renderIcon(50);
    expect(b.length).toBe(ICON_SIZE * ICON_SIZE * 4);
    expect(b[3]).toBe(0);
  });

  it("o anel acompanha a porcentagem e muda de cor", () => {
    expect(rgb(renderIcon(50), 28, 16)).toEqual([70, 190, 120]);
    expect(rgb(renderIcon(10), 28, 16)).toEqual([90, 90, 90]);
    expect(rgb(renderIcon(97), 28, 16)).toEqual([229, 72, 77]);
  });

  it("gera um PNG válido que volta aos mesmos pixels", () => {
    const rgba = renderIcon(42);
    const png = encodePng(rgba, ICON_SIZE, ICON_SIZE);
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const idatAt = png.indexOf("IDAT");
    const len = png.readUInt32BE(idatAt - 4);
    const raw = inflateSync(png.subarray(idatAt + 4, idatAt + 4 + len));
    expect(raw.length).toBe((ICON_SIZE * 4 + 1) * ICON_SIZE);
    expect(Array.from(raw.subarray(1, 1 + ICON_SIZE * 4))).toEqual(Array.from(rgba.subarray(0, ICON_SIZE * 4)));
  });

  it("monta a dica com as duas ferramentas", () => {
    expect(tooltip([["Claude", 42, null], ["Codex", 64, 94]])).toBe("Claude: 5h 42% · sem --\nCodex: 5h 64% · sem 94%");
    expect(tooltip([])).toBe("Token Pets");
  });
});
