import { describe, expect, it } from "vitest";
import { SessionTracker, statusFor, type Touch } from "./sessions";

const touch = (key: string, kind: "main" | "subagent", activity: number, finished = false, extra: Partial<Touch> = {}): Touch => ({
  key,
  tool: "claude",
  kind,
  agentType: null,
  label: key,
  activity,
  tokens: 0,
  finished,
  ...extra,
});

describe("sessions", () => {
  it("limiares de status", () => {
    expect(statusFor(0)).toBe("working");
    expect(statusFor(89)).toBe("working");
    expect(statusFor(90)).toBe("waiting");
    expect(statusFor(599)).toBe("waiting");
    expect(statusFor(600)).toBeNull();
  });

  it("trabalhando → esperando → some", () => {
    const t = new SessionTracker();
    t.touch(touch("a", "main", 1000));
    expect(t.snapshot(1010)[0].status).toBe("working");
    expect(t.snapshot(1100)[0].status).toBe("waiting");
    expect(t.snapshot(1700)).toEqual([]);
    expect(t.size).toBe(0);
  });

  it("subagente finalizado sai rápido e quem trabalha vem primeiro", () => {
    const t = new SessionTracker();
    t.touch(touch("main-old", "main", 1100));
    t.touch(touch("sub", "subagent", 1570, true));
    t.touch(touch("main-new", "main", 1590));
    expect(t.snapshot(1600).map((s) => s.id)).toEqual(["main-new", "sub", "main-old"]);
    expect(t.snapshot(1700).some((s) => s.id === "sub")).toBe(false);
  });

  it("mantém tipo do agente e tokens monotônicos", () => {
    const t = new SessionTracker();
    t.touch(touch("s", "subagent", 10, false, { agentType: "code-reviewer", tokens: 50 }));
    t.touch(touch("s", "subagent", 5, false, { tokens: 20 }));
    t.addTokens("s", 5);
    const s = t.snapshot(20)[0];
    expect(s.agentType).toBe("code-reviewer");
    expect([s.lastActivity, s.tokens]).toEqual([10, 55]);
  });
});
