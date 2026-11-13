import type { Limit } from "./types";

export function formatPercent(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return "--";
  return `${Math.round(Math.max(0, Math.min(100, p)))}%`;
}

/** "agora", "5 min", "2 h 10 min", "3 d 4 h" a partir de segundos. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return "agora";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rm = m % 60;
    return rm ? `${h} h ${rm} min` : `${h} h`;
  }
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d} d ${rh} h` : `${d} d`;
}

export function formatAge(readAt: number, now: number): string {
  const diff = now - readAt;
  return diff < 60 ? "lido agora" : `lido há ${formatDuration(diff)}`;
}

export function barLevel(p: number): "ok" | "warn" | "danger" {
  if (p >= 95) return "danger";
  if (p >= 80) return "warn";
  return "ok";
}

/** Texto de apoio sob a barra: origem do dado, idade e reset. */
export function limitCaption(l: Limit, now: number): string {
  const parts: string[] = [];
  if (l.renewed) parts.push("renovado");
  if (l.source === "estimated") parts.push("estimado");
  else if (l.source === "exact") parts.push("exato");
  if (l.source !== "exact" || now - l.readAt > 120) parts.push(formatAge(l.readAt, now));
  if (!l.renewed && l.resetsAt) parts.push(`renova em ${formatDuration(l.resetsAt - now)}`);
  return parts.join(" · ");
}

export function projectionText(l: Limit, now: number): string | null {
  if (l.projectedExhaustAt == null || l.renewed) return null;
  if (l.resetsAt != null && l.projectedExhaustAt >= l.resetsAt) return null;
  const when = new Date(l.projectedExhaustAt * 1000);
  const dias = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const hh = String(when.getHours()).padStart(2, "0");
  const mm = String(when.getMinutes()).padStart(2, "0");
  const sameDay = new Date(now * 1000).toDateString() === when.toDateString();
  return `nesse ritmo acaba ${sameDay ? "hoje" : dias[when.getDay()]} ${hh}:${mm}`;
}
