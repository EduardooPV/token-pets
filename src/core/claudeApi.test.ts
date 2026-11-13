import { describe, expect, it } from "vitest";
import { parseUsage, tokenFromCredentials } from "./claudeApi";
import { parseIso8601 } from "./util";

describe("claude api parseUsage", () => {
  it("lê as duas janelas com datas ISO", () => {
    const u = parseUsage({
      five_hour: { utilization: 37.0, resets_at: "2026-11-13T03:00:00.123456+00:00" },
      seven_day: { utilization: 26.5, resets_at: "2026-11-18T10:00:00Z" },
      seven_day_opus: null,
    })!;
    expect(u.fiveHour).toEqual({ utilization: 37, resetsAt: parseIso8601("2026-11-13T03:00:00Z") });
    expect(u.sevenDay!.utilization).toBe(26.5);
  });

  it("tolera janela ausente e rejeita formato desconhecido", () => {
    const u = parseUsage({ five_hour: { utilization: 10 } })!;
    expect(u.fiveHour!.resetsAt).toBeNull();
    expect(u.sevenDay).toBeNull();
    expect(parseUsage({ algo: "novo" })).toBeNull();
    expect(parseUsage(null)).toBeNull();
  });

  it("limita utilização fora da faixa", () => {
    expect(parseUsage({ five_hour: { utilization: 140 } })!.fiveHour!.utilization).toBe(100);
  });
});

describe("tokenFromCredentials", () => {
  it("valida expiração e nunca repete o token na mensagem", () => {
    const ok = '{"claudeAiOauth":{"accessToken":"SEGREDO","expiresAt":4102444800000}}';
    expect(tokenFromCredentials(ok, 1000)).toBe("SEGREDO");
    const expired = '{"claudeAiOauth":{"accessToken":"SEGREDO","expiresAt":1000}}';
    expect(() => tokenFromCredentials(expired, 5000)).toThrow(/expirado/);
    try {
      tokenFromCredentials(expired, 5000);
    } catch (e) {
      expect(String(e)).not.toContain("SEGREDO");
    }
    for (const bad of ["{}", "lixo", '{"claudeAiOauth":{"accessToken":""}}']) {
      expect(() => tokenFromCredentials(bad, 0)).toThrow();
    }
  });
});
