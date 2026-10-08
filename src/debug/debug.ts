import type { Game } from '../app/game';

/**
 * ?debug in the URL enables: F1 overlay (FPS, frame/sim ms, points, monsters), F2 reveal level,
 * F3 god mode, F4 skip level, [ / ] slow down / speed up time, \ reset time scale.
 * ?seed=abc and ?depth=N work without ?debug.
 */
export class DebugTools {
  private visible = false;
  private acc = 0;
  private frames = 0;
  private fps = 0;
  private frameMs = 0;
  private scale = 1;

  constructor(private game: Game, readonly enabled: boolean) {}

  onKey(e: KeyboardEvent): void {
    if (!this.enabled) return;
    const g = this.game;
    switch (e.code) {
      case 'F1':
        this.visible = !this.visible;
        g.ui.debugEl.classList.toggle('on', this.visible);
        e.preventDefault();
        break;
      case 'F2':
        if (g.world) g.view.echo.revealAll(g.world, g.view.time);
        e.preventDefault();
        break;
      case 'F3':
        if (g.world) g.world.god = !g.world.god;
        e.preventDefault();
        break;
      case 'F4':
        if (g.world && g.state === 'playing') {
          g.world.player.x = g.world.level.exit.x;
          g.world.player.y = g.world.level.exit.y;
        }
        e.preventDefault();
        break;
      case 'BracketLeft':
        this.scale = Math.max(0.125, this.scale / 2);
        g.loop.timeScale = this.scale;
        break;
      case 'BracketRight':
        this.scale = Math.min(4, this.scale * 2);
        g.loop.timeScale = this.scale;
        break;
      case 'Backslash':
        this.scale = 1;
        g.loop.timeScale = 1;
        break;
    }
  }

  frame(dt: number): void {
    this.frames++;
    this.acc += dt;
    this.frameMs = this.frameMs * 0.9 + dt * 1000 * 0.1;
    if (this.acc < 0.25) return;
    this.fps = this.frames / this.acc;
    this.frames = 0;
    this.acc = 0;
    if (!this.visible) return;
    const g = this.game;
    const w = g.world;
    const info = g.view.renderer.info;
    const lines = [
      `fps ${this.fps.toFixed(0)}  frame ${this.frameMs.toFixed(1)}ms  sim ${g.loop.simMs.toFixed(2)}ms`,
      `draw calls ${info.render.calls}  points ${g.view.cloud.aliveCount(g.view.time)} / ${g.view.cloud.capacity}`,
      `state ${g.state}  timeScale ${g.loop.timeScale}`,
    ];
    if (w && g.run) {
      lines.push(`seed ${g.run.seed}  depth ${w.depth}  tick ${w.tick}  god ${w.god}`);
      lines.push(`player ${w.player.x.toFixed(1)}, ${w.player.y.toFixed(1)}  stones ${w.player.stones}`);
      for (const m of w.monsters) lines.push(`  #${m.id} ${m.kind} ${m.state}  d=${Math.hypot(m.x - w.player.x, m.y - w.player.y).toFixed(1)}`);
    }
    g.ui.debugEl.textContent = lines.join('\n');
  }

  get fpsValue(): number {
    return this.fps;
  }
}
