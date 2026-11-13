import { describe, expect, it } from "vitest";
import { AlertState, evaluate, fmtDuration } from "./alerts";
import type { Limit, SessionInfo, Snapshot } from "../shared/types";

const lim = (pct: number, resets: number): Limit => ({
  usedPercent: pct,
  resetsAt: resets,
  windowMinutes: 300,
  source: "log",
  readAt: 0,
  renewed: false,
  projectedExhaustAt: null,
});

const empty = (): Snapshot => ({
  claude: { tool: "claude", plan: null, fiveHour: null, weekly: null, calibrated: false },
  codex: { tool: "codex", plan: null, fiveHour: null, weekly: null, calibrated: false },
  sessions: [],
  updatedAt: 1000,
  claudeExactError: null,
});

const snap = (codex5: Limit | null): Snapshot => {
  const s = empty();
  s.codex.fiveHour = codex5;
  return s;
};

const session = (id: string, status: "working" | "waiting"): SessionInfo => ({
  id,
  tool: "claude",
  kind: "main",
  agentType: null,
  label: id,
  status,
  lastActivity: 0,
  tokens: 0,
});

describe("alerts", () => {
  it("a primeira leitura nunca avisa, mas arma os limiares", () => {
    const st = new AlertState();
    const first = snap(lim(90, 5000));
    expect(evaluate(null, first, st)).toEqual([]);
    expect(evaluate(first, snap(lim(91, 5000)), st)).toEqual([]);
  });

  it("cruzar 80 e depois 95 avisa uma vez cada", () => {
    const st = new AlertState();
    const a = snap(lim(50, 5000));
    evaluate(null, a, st);
    const b = snap(lim(81, 5000));
    const ev = evaluate(a, b, st);
    expect(ev).toHaveLength(1);
    expect(ev[0].kind).toBe("threshold80");
    expect(ev[0].title).toContain("Codex");
    expect(ev[0].title).toContain("80%");
    expect(evaluate(b, snap(lim(84, 5000)), st)).toEqual([]);
    const c = snap(lim(96, 5000));
    const ev2 = evaluate(b, c, st);
    expect(ev2.map((e) => e.kind)).toEqual(["threshold95"]);
    expect(evaluate(c, snap(lim(97, 5000)), st)).toEqual([]);
  });

  it("pular direto para 95 manda um aviso só", () => {
    const st = new AlertState();
    const a = snap(lim(10, 5000));
    evaluate(null, a, st);
    const ev = evaluate(a, snap(lim(97, 5000)), st);
    expect(ev.map((e) => e.kind)).toEqual(["threshold95"]);
  });

  it("nova janela rearma os limiares e avisa o reset", () => {
    const st = new AlertState();
    const a = snap(lim(85, 5000));
    evaluate(null, a, st);
    const b = snap(lim(3, 23_000));
    expect(evaluate(a, b, st).filter((e) => e.kind === "reset")).toHaveLength(1);
    const c = snap(lim(82, 23_000));
    expect(evaluate(b, c, st).some((e) => e.kind === "threshold80")).toBe(true);
  });

  it("janela marcada como renovada avisa o reset uma vez", () => {
    const st = new AlertState();
    const a = snap(lim(60, 900));
    evaluate(null, a, st);
    const b = snap({ ...lim(0, 900), renewed: true, resetsAt: null });
    expect(evaluate(a, b, st).filter((e) => e.kind === "reset")).toHaveLength(1);
    expect(evaluate(b, b, st)).toEqual([]);
  });

  it("agente que parou avisa uma vez (inclusive se sumiu)", () => {
    const st = new AlertState();
    const a = empty();
    a.sessions = [session("s1", "working"), session("s2", "working")];
    const b = { ...a, sessions: [session("s1", "waiting"), session("s2", "working")] };
    const ev = evaluate(a, b, st);
    expect(ev).toHaveLength(1);
    expect(ev[0].kind).toBe("agentDone");
    expect(ev[0].title).toContain("s1");
    expect(evaluate(b, b, st)).toEqual([]);
    expect(evaluate(b, { ...b, sessions: [] }, st)).toHaveLength(1);
  });

  it("formata duração", () => {
    expect(fmtDuration(20)).toBe("1 min");
    expect(fmtDuration(3600 + 20 * 60)).toBe("1 h 20 min");
    expect(fmtDuration(2 * 86400 + 3 * 3600)).toBe("2 d 3 h");
  });
});
