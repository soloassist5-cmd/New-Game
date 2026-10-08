import './ui/style.css';
import { Game } from './app/game';
import { measureAll } from './audio/sfx';
import { detectLang, setLang, t } from './i18n/strings';

function fatal(message: string): void {
  const ui = document.getElementById('ui')!;
  ui.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'screen on error';
  box.style.pointerEvents = 'auto';
  const h = document.createElement('h2');
  h.className = 'danger';
  h.textContent = t('error.title');
  const p = document.createElement('div');
  p.className = 'muted';
  p.textContent = message;
  const b = document.createElement('button');
  b.className = 'primary';
  b.textContent = t('error.reload');
  b.onclick = () => location.reload();
  box.append(h, p, b);
  ui.append(box);
}

function boot(): void {
  setLang(detectLang());
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) {
    fatal(t('error.webgl'));
    return;
  }
  const game = new Game(canvas);
  let failed = false;
  const onError = (err: unknown): void => {
    console.error(err);
    if (failed) return;
    failed = true;
    try {
      game.loop.stop();
    } catch {
      /* ignore */
    }
    fatal(`${t('error.body')} (${err instanceof Error ? err.message : String(err)})`);
  };
  window.addEventListener('error', (e) => onError(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => onError(e.reason));
  game.start();
  // Hooks for automated smoke tests and audio level checks.
  (window as unknown as Record<string, unknown>).__echo = { game, measureAudio: measureAll };
}

boot();
