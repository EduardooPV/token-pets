import { describe, expect, it } from "vitest";
import { labelFromCwd, parseLine, parseSessionMeta, usageFromSample } from "./codex";

const LINE =
  '{"timestamp":"2026-11-13T00:46:08.451Z","ordinal":319,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":681984,"total_tokens":683830}},"rate_limits":{"limit_id":"codex","limit_name":null,"primary":{"used_percent":64.0,"window_minutes":300,"resets_at":1794543035},"secondary":{"used_percent":94.0,"window_minutes":10080,"resets_at":1794605565},"credits":null,"plan_type":"plus"}}}';

describe("codex parseLine", () => {
  it("lê token_count com rate_limits", () => {
    const s = parseLine(LINE)!;
    expect(s.plan).toBe("plus");
    expect(s.totalTokens).toBe(683_830);
    expect(s.primary).toEqual({ usedPercent: 64, windowMinutes: 300, resetsAt: 1_794_543_035 });
    expect(s.secondary!.usedPercent).toBe(94);
    expect(s.ts).toBeGreaterThan(1_700_000_000);
  });

  it("ignora outras linhas e lixo", () => {
    expect(parseLine('{"type":"event_msg","payload":{"type":"agent_message"}}')).toBeNull();
    expect(parseLine("não é json {token_count")).toBeNull();
    expect(parseLine("")).toBeNull();
  });

  it("ignora limites por modelo", () => {
    expect(parseLine(LINE.replace('"limit_id":"codex"', '"limit_id":"codex_bengalfox"'))).toBeNull();
  });

  it("token_count sem rate_limits mantém só os tokens", () => {
    const s = parseLine('{"timestamp":"2026-11-13T00:46:08Z","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":10}}}}')!;
    expect(s.primary).toBeNull();
    expect(s.secondary).toBeNull();
    expect(s.totalTokens).toBe(10);
  });
});

describe("usageFromSample", () => {
  it("zera e marca renovado depois do horário de reset", () => {
    const s = parseLine(LINE)!;
    const before = usageFromSample(s, 1_794_540_000);
    expect(before.fiveHour).toMatchObject({ usedPercent: 64, renewed: false, source: "log", readAt: s.ts });
    const after = usageFromSample(s, 1_794_543_100);
    expect(after.fiveHour).toMatchObject({ usedPercent: 0, renewed: true });
    expect(after.weekly).toMatchObject({ usedPercent: 94, renewed: false });
  });

  it("sem amostra não há limites", () => {
    const u = usageFromSample(null, 0);
    expect(u.fiveHour).toBeNull();
    expect(u.weekly).toBeNull();
  });
});

describe("session meta", () => {
  it("lê id, cwd e se é subagente; gera rótulo", () => {
    const m = parseSessionMeta('{"type":"session_meta","payload":{"id":"abc","cwd":"C:\\\\Users\\\\Eduar\\\\projects\\\\app-diagnos","parent_thread_id":"zzz"}}')!;
    expect(m.id).toBe("abc");
    expect(m.isSubagent).toBe(true);
    expect(labelFromCwd(m.cwd)).toBe("app-diagnos");
    expect(labelFromCwd(null)).toBe("Codex");
    expect(parseSessionMeta('{"type":"event_msg"}')).toBeNull();
  });
});
