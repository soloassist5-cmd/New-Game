/**
 * Fixed-timestep loop (60 Hz simulation) with render interpolation.
 * `timeScale` drives slow-mo / hit-stop / debug speed without touching the simulation step size.
 */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
const MAX_FRAME = 0.25; // s — clamp after tab switch to avoid a spiral of death

export interface LoopCallbacks {
  /** Called 0..n times per frame with a fixed dt. */
  update(dt: number): void;
  /** Called once per frame. alpha = interpolation factor between previous and current sim state. */
  render(alpha: number, frameDt: number): void;
}

export class FixedLoop {
  timeScale = 1;
  /** Real-time seconds of full freeze (hit-stop). */
  private freeze = 0;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  /** Last measured cost of the update() calls in ms (for the debug overlay). */
  simMs = 0;

  constructor(private cb: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number): void => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  hitStop(seconds: number): void {
    this.freeze = Math.max(this.freeze, seconds);
  }

  private frame(now: number): void {
    const frameDt = Math.min((now - this.last) / 1000, MAX_FRAME);
    this.last = now;
    let simDt = frameDt;
    if (this.freeze > 0) {
      const f = Math.min(this.freeze, simDt);
      this.freeze -= f;
      simDt -= f;
    }
    this.acc += simDt * this.timeScale;
    const t0 = performance.now();
    let steps = 0;
    while (this.acc >= SIM_DT && steps < 8) {
      this.cb.update(SIM_DT);
      this.acc -= SIM_DT;
      steps++;
    }
    if (steps === 8) this.acc = 0;
    this.simMs = performance.now() - t0;
    this.cb.render(this.acc / SIM_DT, frameDt);
  }
}
