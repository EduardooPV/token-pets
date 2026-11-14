import { describe, expect, it } from "vitest";
import { agentLabel, companionName, projectLabel } from "./labels";

describe("nomes amigáveis", () => {
  it("mantém o nome estável sem expor o identificador", () => {
    expect(companionName("claude", "a09ec09-uuid")).toBe(companionName("claude", "a09ec09-uuid"));
    expect(companionName("codex", "a09ec09-uuid")).toMatch(/^Codex · [A-Z]/);
    expect(companionName("claude", "a09ec09-uuid")).not.toContain("uuid");
  });
  it("traduz funções conhecidas e humaniza as personalizadas", () => {
    expect(agentLabel("code-reviewer")).toBe("Revisor de código");
    expect(agentLabel("custom_helper")).toBe("Custom helper");
    expect(agentLabel(" ")).toBeNull();
  });
  it("recupera o projeto de worktrees do Claude e do Codex", () => {
    expect(projectLabel("C:\\projetos\\token-pets\\.claude\\worktrees\\fix-71f9")).toBe("token-pets");
    expect(projectLabel("/projetos/lexo/.codex/worktrees/abc/src")).toBe("lexo");
    expect(projectLabel("/projetos/meu-app/")).toBe("meu-app");
    expect(projectLabel(null)).toBeNull();
  });
});
