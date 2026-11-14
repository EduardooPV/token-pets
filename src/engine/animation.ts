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
 * Cadência adaptável: sprites parados a 12 fps, movimento/interação a 60 fps.
 * Pausa quando a janela está oculta e preserva a fração do intervalo entre quadros.
 */
export class AnimationLoop {
  private raf = 0;
  private last = -Infinity;
  private running = false;
  private requested = true;
  private readonly onVisibility = () => {
    if (document.hidden) this.cancel();
    else if (this.running) {
      this.last = -Infinity;
      this.requestDraw();
    }
  };

  /** `fps` pode variar no tempo; o padrão é MAX_FPS. */
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

  /** A próxima atualização do monitor já responde ao ponteiro, mesmo durante o repouso. */
  requestDraw() {
    this.requested = true;
    if (this.running && !document.hidden) this.schedule();
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
      const interval = 1000 / this.fps();
      const elapsed = t - this.last;
      const due = this.requested ? Math.min(interval, 1000 / 60) : interval;
      if (elapsed >= due - 0.1) {
        this.last = Number.isFinite(this.last) ? this.last + Math.max(1, Math.floor((elapsed + 0.1) / due)) * due : t;
        this.requested = false;
        this.draw(Date.now());
      }
      this.schedule();
    });
  }
}
