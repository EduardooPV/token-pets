// Decide quais avisos disparar comparando o snapshot anterior com o novo (função pura, testável).
import type { AlertEvent, Limit, Snapshot, Tool } from "../shared/types";
import { nowSecs } from "./util";

const THRESHOLDS: Array<[number, AlertEvent["kind"]]> = [
  [95, "threshold95"],
  [80, "threshold80"],
];
const TOOLS: Tool[] = ["claude", "codex"];
const TOOL_NAME: Record<Tool, string> = { claude: "Claude", codex: "Codex" };

export class AlertState {
  /** chaves já avisadas: "tool|janela|resets_at|limiar" */
  readonly fired = new Set<string>();
}

type Win = { win: "5h" | "7d"; label: string; limit: Limit | null };

function windows(s: Snapshot, tool: Tool): [Win, Win] {
  const u = s[tool];
  return [
    { win: "5h", label: "de 5h", limit: u.fiveHour },
    { win: "7d", label: "semanal", limit: u.weekly },
  ];
}

export function fmtDuration(secs: number): string {
  const m = Math.max(1, Math.floor(Math.max(0, secs) / 60));
  if (m < 60) return `${m} min`;
  if (m < 1440) {
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm ? `${h} h ${rm} min` : `${h} h`;
  }
  const d = Math.floor(m / 1440);
  const rh = Math.floor((m % 1440) / 60);
  return rh ? `${d} d ${rh} h` : `${d} d`;
}

/** `prev = null` é a primeira leitura: só registra o que já estava acima dos limiares, sem avisar. */
export function evaluate(prev: Snapshot | null, next: Snapshot, state: AlertState): AlertEvent[] {
  const now = next.updatedAt > 0 ? next.updatedAt : nowSecs();
  const out: AlertEvent[] = [];

  for (const tool of TOOLS) {
    for (const { win, label, limit: l } of windows(next, tool)) {
      if (!l || l.renewed) continue;
      // avisa só o maior limiar cruzado; os menores ficam marcados como já avisados
      let newly: [number, AlertEvent["kind"]] | null = null;
      for (const [thr, kind] of THRESHOLDS) {
        if (l.usedPercent < thr) continue;
        const key = `${tool}|${win}|${l.resetsAt ?? 0}|${thr}`;
        if (!state.fired.has(key)) {
          state.fired.add(key);
          newly ??= [thr, kind];
        }
      }
      if (newly && prev) {
        const est = l.source === "estimated" ? " (estimado)" : "";
        const renova = l.resetsAt != null && l.resetsAt > now ? ` Renova em ${fmtDuration(l.resetsAt - now)}.` : "";
        out.push({
          kind: newly[1],
          title: `${TOOL_NAME[tool]}: ${newly[0]}% do limite ${label}${est}`,
          body: `Uso em ${Math.round(l.usedPercent)}%.${renova}`,
        });
      }
    }
  }
  if (!prev) return out;

  // reset: nova janela (resets_at maior) ou janela marcada como renovada
  for (const tool of TOOLS) {
    const before = windows(prev, tool);
    const after = windows(next, tool);
    for (let i = 0; i < 2; i++) {
      const b = before[i].limit;
      const a = after[i].limit;
      if (!a || !b) continue;
      const wasUsed = !b.renewed && b.usedPercent >= 1;
      const newWindow = b.resetsAt != null && a.resetsAt != null && a.resetsAt > b.resetsAt + 60;
      const becameRenewed = a.renewed && !b.renewed;
      if (wasUsed && (newWindow || becameRenewed)) {
        const tag = `reset|${tool}|${after[i].win}|${b.resetsAt ?? 0}`;
        if (!state.fired.has(tag)) {
          state.fired.add(tag);
          out.push({
            kind: "reset",
            title: `${TOOL_NAME[tool]}: limite ${after[i].label} renovado`,
            body: "Barra zerada, pode voltar a usar à vontade.",
          });
        }
      }
    }
  }

  // agente terminou (ou espera você): trabalhando antes, parado/ausente agora
  for (const s of prev.sessions.filter((x) => x.status === "working")) {
    const still = next.sessions.some((n) => n.id === s.id && n.status === "working");
    if (!still) {
      out.push({ kind: "agentDone", title: `${s.label} parou`, body: `${TOOL_NAME[s.tool]} terminou ou está esperando você.` });
    }
  }
  return out;
}
