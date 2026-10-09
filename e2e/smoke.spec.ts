import { expect, test, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
const SHOTS = process.env.SHOTS_DIR ?? 'test-results/shots';

async function boot(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`/${query}`);
  await page.waitForFunction(() => (window as any).__echo?.game);
  return errors;
}

const state = (page: Page): Promise<string> => page.evaluate(() => (window as any).__echo.game.state);

test('menu loads without console errors', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.locator('h1.title')).toHaveText('ЭХО');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/01-menu.png` });
  expect(errors).toEqual([]);
});

test('play: walk, clap, see the echo, throw a stone', async ({ page }) => {
  const errors = await boot(page, '?seed=smoke&depth=2');
  await page.getByRole('button', { name: 'Спуститься' }).click();
  await expect.poll(() => state(page)).toBe('playing');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/02-arrival.png` });

  const before = await page.evaluate(() => {
    const p = (window as any).__echo.game.world.player;
    return { x: p.x, y: p.y };
  });
  // Software GL renders ~4 fps here and the loop caps catch-up ticks, so poll on game state, not wall time.
  await page.keyboard.down('KeyW');
  await expect
    .poll(
      () =>
        page.evaluate(([bx, by]) => {
          const w = (window as any).__echo.game.world;
          return Math.hypot(w.player.x - bx, w.player.y - by) > 0.5 && w.stats.steps > 0;
        }, [before.x, before.y]),
      { timeout: 15000 },
    )
    .toBe(true);
  await page.keyboard.up('KeyW');

  await page.keyboard.press('Space');
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${SHOTS}/03-clap-wave.png` });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/04-clap-full.png` });
  const claps = await page.evaluate(() => (window as any).__echo.game.world.stats.claps);
  expect(claps).toBe(1);

  await page.keyboard.press('KeyF');
  await page.waitForTimeout(1500);
  const throws = await page.evaluate(() => (window as any).__echo.game.world.stats.throws);
  expect(throws).toBe(1);
  await page.screenshot({ path: `${SHOTS}/05-stone.png` });
  expect(errors).toEqual([]);
});

test('monster reveal, death screen and instant restart', async ({ page }) => {
  const errors = await boot(page, '?seed=smoke&depth=3');
  await page.getByRole('button', { name: 'Спуститься' }).click();
  await expect.poll(() => state(page)).toBe('playing');
  // Put a stalker a few metres in front of the player, in line of sight, and clap.
  await page.evaluate(() => {
    const g = (window as any).__echo.game;
    const w = g.world;
    const p = w.player;
    const m = w.monsters.find((mo: any) => mo.kind === 'stalker');
    let d = 4;
    while (d > 1.2) {
      const x = p.x + Math.cos(p.yaw) * d;
      const y = p.y + Math.sin(p.yaw) * d;
      if (w.level.cells[Math.floor(y / 2) * w.level.w + Math.floor(x / 2)] === 0) {
        m.x = m.prevX = x;
        m.y = m.prevY = y;
        break;
      }
      d -= 0.5;
    }
    m.state = 'linger';
    m.timer = 100;
  });
  await page.keyboard.press('Space');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/06-monster.png` });
  // Let it catch us.
  await page.evaluate(() => {
    const g = (window as any).__echo.game;
    const m = g.world.monsters.find((mo: any) => mo.kind === 'stalker');
    m.state = 'hunt';
    m.x = g.world.player.x + 0.5;
    m.y = g.world.player.y;
  });
  await expect.poll(() => state(page)).toBe('dying');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/07-killcam.png` });
  await expect.poll(() => state(page)).toBe('dead');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/08-death.png` });
  // Restart latency measured inside the page, independent of the (slow) frame rate.
  const restartMs = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const g = (window as any).__echo.game;
        const t0 = performance.now();
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR' }));
        const check = (): void => {
          if (g.state === 'playing') resolve(performance.now() - t0);
          else setTimeout(check, 5);
        };
        check();
      }),
  );
  expect(restartMs).toBeLessThan(1000);
  expect(errors).toEqual([]);
});

test('exit leads to the upgrade screen and the next depth', async ({ page }) => {
  const errors = await boot(page, '?seed=smoke');
  await page.getByRole('button', { name: 'Спуститься' }).click();
  await expect.poll(() => state(page)).toBe('playing');
  await page.evaluate(() => {
    const w = (window as any).__echo.game.world;
    w.player.x = w.level.exit.x + 0.5;
    w.player.y = w.level.exit.y;
  });
  await expect.poll(() => state(page)).toBe('upgrade');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/09-upgrade.png` });
  await page.keyboard.press('Digit1');
  await expect.poll(() => state(page)).toBe('playing');
  expect(await page.evaluate(() => (window as any).__echo.game.world.depth)).toBe(2);
  expect(errors).toEqual([]);
});

test('pressing Space right after starting claps instead of re-clicking the menu button', async ({ page }) => {
  const errors = await boot(page, '?seed=focus');
  const runs = await page.evaluate(() => (window as any).__echo.game.save.stats.runs);
  await page.getByRole('button', { name: 'Спуститься' }).click();
  await page.keyboard.press('Space');
  await expect.poll(() => state(page)).toBe('playing');
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as any).__echo.game.save.stats.runs)).toBe(runs + 1);
  expect(await page.evaluate(() => (window as any).__echo.game.world.stats.claps)).toBe(1);
  expect(errors).toEqual([]);
});

test('settings and pause screens render', async ({ page }) => {
  const errors = await boot(page);
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/10-settings.png` });
  await page.getByRole('button', { name: 'Назад' }).click();
  await expect.poll(() => state(page)).toBe('menu');
  expect(errors).toEqual([]);
});

test('every procedural sound peaks below -1 dBFS', async ({ page }) => {
  await boot(page);
  const report = await page.evaluate(() => (window as any).__echo.measureAudio());
  console.table(report.map((r: any) => ({ name: r.name, peak: r.peakDb.toFixed(1), rms: r.rmsDb.toFixed(1) })));
  for (const r of report) expect(r.peakDb, r.name).toBeLessThan(-1);
});

test('performance: frame time in a heavy scene', async ({ page }) => {
  await boot(page, '?seed=perf&depth=6&debug');
  await page.getByRole('button', { name: 'Спуститься' }).click();
  await expect.poll(() => state(page)).toBe('playing');
  // Several claps in a row = worst-case point count.
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => ((window as any).__echo.game.world.player.clapCd = 0));
    await page.keyboard.press('Space');
    await page.waitForTimeout(250);
  }
  const ms = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const out: number[] = [];
        let last = performance.now();
        const tick = (now: number): void => {
          out.push(now - last);
          last = now;
          if (out.length < 90) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
  );
  ms.sort((a, b) => a - b);
  const sim = await page.evaluate(() => (window as any).__echo.game.loop.simMs);
  console.log(`frame ms p50=${ms[45].toFixed(1)} p95=${ms[85].toFixed(1)} (software GL) · sim ms=${sim.toFixed(2)}`);
  expect(sim).toBeLessThan(4);
});
