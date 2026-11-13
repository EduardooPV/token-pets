import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ApiWindow } from "./claudeApi";
import { Caps, Engine, buildClaudeUsage, calibrate, type ExactReading } from "./engine";
import { Store } from "./store";
import { formatIso8601, nowSecs } from "./util";

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "tp-eng-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const assistant = (id: string, ts: number, input: number, output: number) =>
  JSON.stringify({
    type: "assistant",
    timestamp: formatIso8601(ts),
    cwd: "C:\\proj\\meu-app",
    message: { id, usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  });

const write = (path: string, lines: string[]) => {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, lines.map((l) => `${l}\n`).join(""));
};

const engine = (store: Store, claudeRoot: string, codexRoot: string, now: number) => new Engine(store, claudeRoot, codexRoot, now);

describe("Engine (Claude)", () => {
  it("conta mensagens únicas e acompanha a sessão", () => {
    const [claude, codex] = [tmp(), tmp()];
    const now = nowSecs();
    const f = join(claude, "proj", "sess1.jsonl");
    write(f, [
      '{"type":"custom-title","customTitle":"Minha sessão"}',
      assistant("m1", now - 30, 100, 10),
      assistant("m1", now - 30, 100, 40), // mesmo id, saída maior: conta só o acréscimo
      assistant("m2", now - 10, 50, 0),
    ]);
    const e = engine(new Store(":memory:"), claude, codex, now);
    e.handlePath(f, now);
    const [s5, s7] = e.windowSums(now);
    const expected = 100 + 5 * 40 + 50;
    expect(s5).toBeCloseTo(expected, 6);
    expect(s7).toBeCloseTo(expected, 6);
    const snap = e.snapshot(now);
    expect(snap.sessions).toHaveLength(1);
    expect(snap.sessions[0]).toMatchObject({ label: "Minha sessão", status: "working", tokens: 100 + 40 + 50 });
    expect(snap.claude.fiveHour!.source).toBe("estimated");
    expect(snap.claude.fiveHour!.usedPercent).toBeGreaterThan(0);
  });

  it("rótulo cai para a pasta e tokens fora da janela de 5h não entram", () => {
    const [claude, codex] = [tmp(), tmp()];
    const now = nowSecs();
    const f = join(claude, "p", "s2.jsonl");
    write(f, [assistant("a", now - 6 * 3600, 1000, 0), assistant("b", now - 5, 10, 0)]);
    const e = engine(new Store(":memory:"), claude, codex, now);
    e.handlePath(f, now);
    expect(e.windowSums(now)).toEqual([10, 1010]);
    expect(e.snapshot(now).sessions[0].label).toBe("meu-app");
  });

  it("reiniciar não conta em dobro graças aos offsets salvos", () => {
    const [claude, codex] = [tmp(), tmp()];
    const now = nowSecs();
    const f = join(claude, "p", "s3.jsonl");
    write(f, [assistant("a", now - 20, 200, 0)]);
    const store = new Store(":memory:");
    const e1 = engine(store, claude, codex, now);
    e1.initialScan(now);
    expect(e1.windowSums(now)[0]).toBe(200);
    const e2 = engine(store, claude, codex, now);
    e2.initialScan(now);
    expect(e2.windowSums(now)[0]).toBe(200);
    write(f, [assistant("b", now - 5, 30, 0)]);
    e2.handlePath(f, now);
    expect(e2.windowSums(now)[0]).toBe(230);
  });

  it("subagente ganha tipo e rótulo do meta e some ao finalizar", () => {
    const [claude, codex] = [tmp(), tmp()];
    const now = nowSecs();
    const dir = join(claude, "p", "sess", "subagents");
    const jl = join(dir, "agent-ab12.jsonl");
    const meta = join(dir, "agent-ab12.meta.json");
    write(jl, [assistant("s1", now - 5, 10, 1)]);
    writeFileSync(meta, '{"agentType":"security-probe","description":"Sonda de segurança","finished":false}');
    const e = engine(new Store(":memory:"), claude, codex, now);
    e.handlePath(jl, now);
    const s = e.snapshot(now).sessions;
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: "subagent", agentType: "security-probe", label: "Sonda de segurança" });
    writeFileSync(meta, '{"agentType":"security-probe","description":"Sonda de segurança","finished":true}');
    e.handlePath(meta, now); // o evento do .meta.json reprocessa o .jsonl
    expect(e.snapshot(now + 60).sessions).toHaveLength(0);
  });
});

describe("Engine (Codex)", () => {
  it("lê limites e sessão do rollout e marca renovado depois do reset", () => {
    const [claude, codex] = [tmp(), tmp()];
    const now = nowSecs();
    const f = join(codex, "2026", "11", "12", "rollout-a.jsonl");
    const meta = '{"type":"session_meta","payload":{"id":"abc","cwd":"C:\\\\Users\\\\x\\\\codex-proj"}}';
    const tc = JSON.stringify({
      timestamp: formatIso8601(now - 20),
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { total_token_usage: { total_tokens: 777 } },
        rate_limits: {
          limit_id: "codex",
          primary: { used_percent: 64, window_minutes: 300, resets_at: now + 3600 },
          secondary: { used_percent: 94, window_minutes: 10080, resets_at: now + 86_400 },
          plan_type: "plus",
        },
      },
    });
    write(f, [meta, tc]);
    const e = engine(new Store(":memory:"), claude, codex, now);
    e.initialScan(now);
    const snap = e.snapshot(now);
    expect(snap.codex.fiveHour).toMatchObject({ usedPercent: 64, source: "log" });
    expect(snap.codex.weekly!.usedPercent).toBe(94);
    expect(snap.codex.plan).toBe("plus");
    expect(snap.sessions).toHaveLength(1);
    expect(snap.sessions[0]).toMatchObject({ tool: "codex", label: "codex-proj", tokens: 777 });
    expect(e.snapshot(now + 3601).codex.fiveHour!.renewed).toBe(true);
  });

  it("pastas inexistentes não quebram", () => {
    const now = nowSecs();
    const e = engine(new Store(":memory:"), "Z:/nao/existe/claude", "Z:/nao/existe/codex", now);
    e.initialScan(now);
    const s = e.snapshot(now);
    expect(s.sessions).toEqual([]);
    expect(s.codex.fiveHour).toBeNull();
  });
});

describe("limite exato do Claude", () => {
  const caps: Caps = { five: 1000, week: 10_000, calibrated: false };
  const w = (utilization: number, resetsAt: number | null): ApiWindow => ({ utilization, resetsAt });

  it("o exato substitui a estimativa e expira depois de 15 min", () => {
    const exact: ExactReading = { five: w(37, 5000), week: w(20, 900_000), readAt: 1000 };
    const h5 = buildClaudeUsage(1100, 500, 500, caps, exact).fiveHour!;
    expect([h5.usedPercent, h5.source, h5.resetsAt]).toEqual([37, "exact", 5000]);
    expect(buildClaudeUsage(1000 + 16 * 60, 500, 500, caps, exact).fiveHour!.source).toBe("estimated");
    const est = buildClaudeUsage(1100, 500, 5000, caps, null);
    expect([est.fiveHour!.usedPercent, est.weekly!.usedPercent]).toEqual([50, 50]);
    const old: ExactReading = { five: w(90, 1100), week: null, readAt: 1190 };
    expect(buildClaudeUsage(1200, 0, 0, caps, old).fiveHour!.renewed).toBe(true);
  });

  it("calibração ajusta o teto pelo % exato", () => {
    expect(calibrate(500, 25, 1)).toBe(2000);
    expect(calibrate(500, 1, 1234)).toBe(1234);
    expect(calibrate(0, 50, 1234)).toBe(1234);
  });

  it("setExact calibra os tetos; falha mantém a estimativa e guarda o motivo", () => {
    const [claude, codex] = [tmp(), tmp()];
    const now = nowSecs();
    const f = join(claude, "p", "s6.jsonl");
    write(f, [assistant("a", now - 20, 1000, 0)]);
    const store = new Store(":memory:");
    const e = engine(store, claude, codex, now);
    e.handlePath(f, now);
    e.setExact({ ok: { fiveHour: w(10, now + 1000), sevenDay: null } }, now);
    const snap = e.snapshot(now);
    expect(snap.claude.calibrated).toBe(true);
    expect(snap.claude.fiveHour!.source).toBe("exact");
    expect(store.get("claude_cap_5h")).toBe("10000");
    e.setExact({ error: "login expirado" }, now + 2000);
    const later = e.snapshot(now + 2000);
    expect(later.claudeExactError).toBe("login expirado");
    expect(later.claude.fiveHour!.source).toBe("estimated");
    expect(later.claude.fiveHour!.usedPercent).toBeCloseTo(10, 6);
  });

  it("desligar o exato esconde a leitura", () => {
    const [claude, codex] = [tmp(), tmp()];
    const now = nowSecs();
    const store = new Store(":memory:");
    const e = engine(store, claude, codex, now);
    e.setExact({ ok: { fiveHour: w(40, null), sevenDay: null } }, now);
    expect(e.snapshot(now).claude.fiveHour!.source).toBe("exact");
    store.setBool("claude_exact", false);
    expect(e.snapshot(now).claude.fiveHour!.source).toBe("estimated");
  });
});
