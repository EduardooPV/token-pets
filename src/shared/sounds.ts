import type { AlertKind } from "./types";

/** [frequência Hz, duração s] de cada bipe. Sons curtos gerados na hora, sem arquivos. */
const PATTERNS: Record<AlertKind, Array<[number, number]>> = {
  threshold80: [[660, 0.12]],
  threshold95: [[880, 0.1], [660, 0.1], [880, 0.14]],
  reset: [[523, 0.1], [659, 0.1], [784, 0.16]],
  agentDone: [[784, 0.08], [988, 0.12]],
};

export function soundPattern(kind: AlertKind): Array<[number, number]> {
  return PATTERNS[kind] ?? PATTERNS.agentDone;
}

let ctx: AudioContext | null = null;

/** Toca o som do aviso. Só toca com a janela visível, para não gastar nada em segundo plano. */
export function playAlertSound(kind: AlertKind): void {
  if (document.hidden) return;
  try {
    ctx ??= new AudioContext();
    let t = ctx.currentTime;
    for (const [freq, dur] of soundPattern(kind)) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.04, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
      t += dur + 0.03;
    }
  } catch {
    // sem áudio disponível: segue em silêncio
  }
}
