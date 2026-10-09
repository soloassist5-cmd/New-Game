import { expect, test } from '@playwright/test';

const SHOTS = process.env.SHOTS_DIR ?? 'test-results/shots';

test('landing renders, links to the game and the sonar reacts to clicks', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    // External font CDN hiccups are not our bug; everything else is.
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errors.push(m.text());
  });
  await page.goto('/');
  await expect(page.locator('h1.title')).toHaveText('ЭХО');
  await expect(page.getByRole('link', { name: 'Играть в браузере' })).toHaveAttribute('href', 'play/');
  await expect(page.locator('.scale-row')).toHaveCount(6);
  await page.mouse.click(300, 420);
  await expect(page.locator('#ro-claps')).not.toHaveText('0');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/20-landing-hero.png` });
  await page.screenshot({ path: `${SHOTS}/21-landing-full.png`, fullPage: true });
  for (const asset of ['trailer.mp4', 'trailer-poster.jpg', 'img/stalker.jpg', 'img/listener.jpg']) {
    const res = await request.get(`/${asset}`);
    expect(res.status(), asset).toBe(200);
  }
  expect(errors).toEqual([]);
});

test('landing works at phone width without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/22-landing-phone.png`, fullPage: true });
});

test('"Играть" opens the game', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Играть в браузере' }).click();
  await expect(page).toHaveURL(/\/play\/$/);
  await expect(page.getByRole('button', { name: 'Спуститься' })).toBeVisible();
});
