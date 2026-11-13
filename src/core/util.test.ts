import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TailState, firstLine, formatIso8601, parseIso8601, readNewLines } from "./util";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "tp-util-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("iso8601", () => {
  it("interpreta formatos com Z, microssegundos e offset", () => {
    expect(parseIso8601("1970-01-01T00:00:00Z")).toBe(0);
    expect(parseIso8601("2000-01-01T00:00:00Z")).toBe(946_684_800);
    expect(parseIso8601("2024-02-29T12:00:00+02:00")).toBe(1_709_200_800);
    expect(parseIso8601("2024-02-29T10:00:00.123456Z")).toBe(1_709_200_800);
    expect(parseIso8601("2024-02-29T07:00:00-03:00")).toBe(1_709_200_800);
  });

  it("rejeita lixo", () => {
    expect(parseIso8601("lixo")).toBeNull();
    expect(parseIso8601("2024-13-01T00:00:00Z")).toBeNull();
    expect(parseIso8601(null)).toBeNull();
  });

  it("formata e interpreta de volta", () => {
    for (const ts of [0, 946_684_800, 1_709_200_800, 1_794_543_035]) expect(parseIso8601(formatIso8601(ts))).toBe(ts);
  });
});

describe("readNewLines", () => {
  it("lê de forma incremental e mantém a linha parcial", () => {
    const p = join(tmp(), "a.jsonl");
    writeFileSync(p, "a\nb\npar");
    const st = new TailState();
    const got: string[] = [];
    expect(readNewLines(p, st, (l) => got.push(l))).toBe(2);
    expect(got).toEqual(["a", "b"]);
    appendFileSync(p, "cial\nc\n");
    got.length = 0;
    readNewLines(p, st, (l) => got.push(l));
    expect(got).toEqual(["parcial", "c"]);
    expect(readNewLines(p, st, () => {})).toBe(0);
  });

  it("recomeça do zero se o arquivo encolheu", () => {
    const p = join(tmp(), "b.jsonl");
    writeFileSync(p, "um\ndois\ntres\n");
    const st = new TailState();
    readNewLines(p, st, () => {});
    writeFileSync(p, "x\n");
    const got: string[] = [];
    readNewLines(p, st, (l) => got.push(l));
    expect(got).toEqual(["x"]);
  });

  it("aceita CRLF e linhas maiores que o bloco de leitura", () => {
    const p = join(tmp(), "c.jsonl");
    const big = "x".repeat(2 * 1024 * 1024);
    writeFileSync(p, `${big}\r\nfim\r\n`);
    const got: number[] = [];
    readNewLines(p, new TailState(), (l) => got.push(l.length));
    expect(got).toEqual([big.length, 3]);
  });

  it("arquivo inexistente lança erro em vez de travar", () => {
    expect(() => readNewLines("Z:/nao/existe.jsonl", new TailState(), () => {})).toThrow();
  });

  it("firstLine respeita o limite", () => {
    const p = join(tmp(), "d.jsonl");
    writeFileSync(p, "primeira\nsegunda\n");
    expect(firstLine(p, 1024)).toBe("primeira");
    expect(firstLine(join(tmp(), "nao.jsonl"), 10)).toBeNull();
  });
});
