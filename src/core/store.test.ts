import { describe, expect, it } from "vitest";
import { Store } from "./store";

describe("Store", () => {
  it("kv com padrões e sobrescrita", () => {
    const s = new Store(":memory:");
    expect(s.get("x")).toBeNull();
    expect(s.getBool("pet", true)).toBe(true);
    s.setBool("pet", false);
    expect(s.getBool("pet", true)).toBe(false);
    s.set("x", "1");
    s.set("x", "2");
    expect(s.get("x")).toBe("2");
  });

  it("amostras, histórico e limpeza; ignora duplicadas", () => {
    const s = new Store(":memory:");
    s.addSample(100, "codex", "5h", 10);
    s.addSample(200, "codex", "5h", 20);
    s.addSample(200, "codex", "5h", 20); // duplicada
    s.addSample(200, "claude", "7d", 5);
    expect(s.samplesSince("codex", "5h", 150)).toEqual([[200, 20]]);
    expect(s.history(0)).toHaveLength(3);
    s.pruneSamples(150);
    expect(s.history(0)).toHaveLength(2);
  });

  it("minutos e offsets persistem com upsert", () => {
    const s = new Store(":memory:");
    s.saveMinutes([[10, 1.5, 3], [11, 2, 4]]);
    s.saveMinutes([[10, 9, 9]]);
    expect(s.loadMinutes(0).sort((a, b) => a[0] - b[0])).toEqual([[10, 9, 9], [11, 2, 4]]);
    s.pruneMinutes(11);
    expect(s.loadMinutes(0)).toHaveLength(1);
    s.saveOffsets([["a.jsonl", 10]]);
    s.saveOffsets([["a.jsonl", 20]]);
    expect(s.loadOffsets()).toEqual([["a.jsonl", 20]]);
  });
});
