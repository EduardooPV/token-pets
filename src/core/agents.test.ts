import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentColors, parseAgentFrontmatter } from "./agents";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "tp-agents-"));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const agent = (root: string, file: string, body: string) => {
  const d = join(root, ".claude", "agents");
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, file), body);
};

describe("parseAgentFrontmatter", () => {
  it("lê name e color", () => {
    expect(parseAgentFrontmatter("---\nname: seo-reviewer\ncolor: blue\nmodel: sonnet\n---\ncorpo")).toEqual({ name: "seo-reviewer", color: "blue" });
  });
  it("aceita CRLF e aspas; color é opcional", () => {
    expect(parseAgentFrontmatter('---\r\nname: "a"\r\n---\r\nx')).toEqual({ name: "a", color: null });
  });
  it("sem frontmatter ou sem name devolve null", () => {
    expect(parseAgentFrontmatter("# só texto")).toBeNull();
    expect(parseAgentFrontmatter("---\ncolor: red\n---")).toBeNull();
  });
});

describe("AgentColors", () => {
  it("acha o agente no repo subindo a partir de uma subpasta", () => {
    const repo = tmp();
    agent(repo, "r.md", "---\nname: Frontend-Reviewer\ncolor: green\n---\n");
    const c = new AgentColors(tmp());
    expect(c.lookup("frontend-reviewer", join(repo, "apps", "web"))).toBe("green");
  });

  it("o repo vence o ~/.claude e o home é o fallback", () => {
    const repo = tmp();
    const home = tmp();
    agent(repo, "a.md", "---\nname: x\ncolor: red\n---\n");
    agent(home, "a.md", "---\nname: x\ncolor: blue\n---\n");
    agent(home, "b.md", "---\nname: y\ncolor: pink\n---\n");
    const c = new AgentColors(home);
    expect(c.lookup("x", repo)).toBe("red");
    expect(c.lookup("y", repo)).toBe("pink");
  });

  it("sem tipo, sem cwd ou pasta inexistente devolve null sem erro", () => {
    const c = new AgentColors(tmp());
    expect(c.lookup(null, "/nada")).toBeNull();
    expect(c.lookup("x", null)).toBeNull();
    expect(c.lookup("x", "/pasta/que/nao/existe")).toBeNull();
  });
});
