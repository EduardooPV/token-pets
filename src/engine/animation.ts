import type { SessionInfo, Tool, ToolUsage } from "../shared/types";
import type { PetState } from "./sprites";

export const MAX_FPS = 12;

/** Quantos quadros e quanto tempo (ms) cada estado usa. */
export const ANIMATIONS: Record<PetState, { frames: number; ms: number }> = {
  idle: { frames: 2, ms: 700 },
  working: { frames: 3, ms: 260 },
  waiting: { frames: 2, ms: 500 },
  tired: { frames: 2, ms: 650 },
  exhausted: { frames: 2, ms: 500 },
  sleeping: { frames: 2, ms: 900 },
  celebrating: { frames: 2, ms: 220 },
};

export const PET_STATES = Object.keys(ANIMATIONS) as PetState[];

export function maxUsedPercent(u: ToolUsage): number | null {
  const vals = [u.fiveHour, u.weekly].filter((l) => l && !l.renewed).map((l) => l!.usedPercent);
  return vals.length ? Math.max(...vals) : null;
}

export function justRenewed(u: ToolUsage): boolean {
  return Boolean(u.fiveHour?.renewed || u.weekly?.renewed);
}

/** Prioridade: comemorando > exausto > cansado > trabalhando > esperando > ocioso. */
export function petStateFor(session: Pick<SessionInfo, "status"> | null, usage: ToolUsage): PetState {
  if (justRenewed(usage)) return "celebrating";
  const pct = maxUsedPercent(usage);
  if (pct != null && pct >= 95) return "exhausted";
  if (pct != null && pct >= 80) return "tired";
  if (!session) return "sleeping";
  return session.status === "working" ? "working" : "waiting";
}

export function usageFor(tool: Tool, claude: ToolUsage, codex: ToolUsage): ToolUsage {
  return tool === "claude" ? claude : codex;
}

export function frameAt(state: PetState, nowMs: number): number {
  const a = ANIMATIONS[state];
  return Math.floor(nowMs / a.ms) % a.frames;
}

/**
 * Laço de animação limitado a 12 fps que pausa quando a janela está oculta.
 * `draw` só é chamado quando há pelo menos um quadro novo para desenhar.
 */
export class AnimationLoop {
  private raf = 0;
  private last = 0;
  private running = false;
  private readonly onVisibility = () => {
    if (document.hidden) this.cancel();
    else if (this.running) this.schedule();
  };

  /** `fps` pode variar no tempo (ex.: 30 fps só enquanto algo se move); o padrão é MAX_FPS. */
  constructor(
    private readonly draw: (nowMs: number) => void,
    private readonly fps: () => number = () => MAX_FPS,
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    document.addEventListener("visibilitychange", this.onVisibility);
    if (!document.hidden) this.schedule();
  }

  stop() {
    this.running = false;
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.cancel();
  }

  private cancel() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame((t) => {
      this.raf = 0;
      if (!this.running || document.hidden) return;
      if (t - this.last >= 1000 / this.fps() - 1) {
        this.last = t;
        this.draw(Date.now());
      }
      this.schedule();
    });
  }
}
