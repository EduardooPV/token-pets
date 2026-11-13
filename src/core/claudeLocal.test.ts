import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyPath, labelFromCwd, parseAgentMeta, parseLine, weigh } from "./claudeLocal";

const ASSISTANT =
  '{"type":"assistant","timestamp":"2026-11-13T00:46:08.451Z","cwd":"C:\\\\Users\\\\Eduar\\\\Documents\\\\projects\\\\diagnos","sessionId":"s1","message":{"id":"msg_1","model":"claude-opus-5-5","role":"assistant","content":[{"type":"text","text":"oi"}],"usage":{"input_tokens":2,"cache_creation_input_tokens":2354,"cache_read_input_tokens":98945,"output_tokens":632,"service_tier":"standard"}}}';

describe("claude parseLine", () => {
  it("lê o uso de mensagens do assistente", () => {
    const r = parseLine(ASSISTANT);
    expect(r?.kind).toBe("usage");
    if (r?.kind !== "usage") return;
    expect(r.usage.messageId).toBe("msg_1");
    expect(r.usage.tokens).toBe(2 + 2354 + 98945 + 632);
    expect(r.usage.weighted).toBeCloseTo(weigh(2, 632, 2354, 98945), 6);
    expect(labelFromCwd(r.usage.cwd)).toBe("diagnos");
  });

  it("lê custom-title e ignora o resto", () => {
    expect(parseLine('{"type":"custom-title","customTitle":"Token usage monitoring app","sessionId":"s1"}')).toEqual({
      kind: "title",
      title: "Token usage monitoring app",
    });
    expect(parseLine('{"type":"custom-title","customTitle":"  "}')).toBeNull();
    expect(parseLine('{"type":"user","message":{"role":"user","content":"oi"}}')).toBeNull();
    expect(parseLine('{quebrado "usage"')).toBeNull();
    expect(parseLine('{"type":"assistant","timestamp":"2026-11-13T00:46:08Z","message":{"id":"m","usage":null}}')).toBeNull();
  });
});

describe("classifyPath", () => {
  const root = join("C:", "u", ".claude", "projects");
  it("principal e subagente", () => {
    expect(classifyPath(join(root, "proj", "abc.jsonl"), root)).toEqual({ kind: "main", sessionId: "abc" });
    expect(classifyPath(join(root, "proj", "abc", "subagents", "agent-a33f.jsonl"), root)).toEqual({
      kind: "subagent",
      sessionId: "abc",
      agentId: "a33f",
    });
  });
  it("ignora o que não é transcript", () => {
    expect(classifyPath(join(root, "proj", "abc", "custom-title.json"), root)).toBeNull();
    expect(classifyPath(join(root, "proj", "abc", "outro", "x.jsonl"), root)).toBeNull();
    expect(classifyPath(join("D:", "fora", "x.jsonl"), root)).toBeNull();
  });
});

describe("parseAgentMeta", () => {
  it("lê tipo, descrição e finished; tolera lixo", () => {
    expect(parseAgentMeta('{"agentType":"security-probe","description":"Security probe","finished":true}')).toEqual({
      agentType: "security-probe",
      description: "Security probe",
      finished: true,
    });
    expect(parseAgentMeta("lixo")).toEqual({ agentType: null, description: null, finished: false });
  });
});
