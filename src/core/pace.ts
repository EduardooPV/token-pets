// Projeção de quando um limite esgota, por regressão linear das amostras recentes.

/**
 * `samples`: [epoch s, % usado] em qualquer ordem. Só usa amostras da janela atual (a partir de `windowStart`)
 * e dos últimos `lookbackSecs`. Devolve o epoch previsto para chegar a 100%, ou null se não esgota.
 */
export function projectExhaustion(
  samples: Array<[number, number]>,
  now: number,
  windowStart: number,
  lookbackSecs: number,
  currentPct: number,
): number | null {
  if (currentPct >= 100) return now;
  const from = Math.max(windowStart, now - lookbackSecs);
  const pts = samples.filter(([t]) => t >= from && t <= now).sort((a, b) => a[0] - b[0]);
  if (pts.length < 3) return null;
  const span = pts[pts.length - 1][0] - pts[0][0];
  if (span < 300) return null; // menos de 5 min de histórico: não dá para estimar ritmo
  const n = pts.length;
  const meanT = pts.reduce((s, p) => s + p[0], 0) / n;
  const meanP = pts.reduce((s, p) => s + p[1], 0) / n;
  const sxx = pts.reduce((s, p) => s + (p[0] - meanT) ** 2, 0);
  if (sxx === 0) return null;
  const slope = pts.reduce((s, p) => s + (p[0] - meanT) * (p[1] - meanP), 0) / sxx; // % por segundo
  if (slope <= 1e-7) return null; // estável ou caindo
  const remaining = (100 - currentPct) / slope;
  if (!Number.isFinite(remaining) || remaining > 30 * 86400) return null;
  return now + Math.floor(remaining);
}
