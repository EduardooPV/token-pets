import type { HistoryPoint, Tool } from "../shared/types";

export const CHART_W = 356;
export const CHART_H = 96;
const PAD = { l: 26, r: 8, t: 8, b: 14 };

export interface ChartData {
  paths: { "5h": string; "7d": string };
  /** linhas de referência (80% e 95%) já em coordenadas y */
  guides: Array<{ y: number; label: string }>;
  /** marcas do eixo x: um dia por marca */
  ticks: Array<{ x: number; label: string }>;
  hasData: boolean;
}

const px = (n: number) => Math.round(n * 10) / 10;

export function buildChart(points: HistoryPoint[], tool: Tool, nowSecs: number, days = 7): ChartData {
  const from = nowSecs - days * 86400;
  const innerW = CHART_W - PAD.l - PAD.r;
  const innerH = CHART_H - PAD.t - PAD.b;
  const x = (ts: number) => px(PAD.l + ((ts - from) / (nowSecs - from)) * innerW);
  const y = (pct: number) => px(PAD.t + (1 - Math.max(0, Math.min(100, pct)) / 100) * innerH);
  const path = (win: "5h" | "7d") => {
    const pts = points.filter((p) => p.tool === tool && p.window === win && p.ts >= from && p.ts <= nowSecs).sort((a, b) => a.ts - b.ts);
    return pts.map((p, i) => `${i ? "L" : "M"}${x(p.ts)} ${y(p.pct)}`).join(" ");
  };
  const paths = { "5h": path("5h"), "7d": path("7d") };
  const dias = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const ticks = Array.from({ length: days }, (_, i) => {
    const ts = nowSecs - (days - 1 - i) * 86400;
    return { x: x(ts), label: dias[new Date(ts * 1000).getDay()] };
  });
  return {
    paths,
    guides: [
      { y: y(95), label: "95" },
      { y: y(80), label: "80" },
      { y: y(50), label: "50" },
    ],
    ticks,
    hasData: Boolean(paths["5h"] || paths["7d"]),
  };
}
