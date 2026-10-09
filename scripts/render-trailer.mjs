// Renders the in-engine trailer frame by frame and encodes it.
//   npm run build && node scripts/render-trailer.mjs            -> public/trailer.mp4 + poster
//   node scripts/render-trailer.mjs --preview                   -> one frame per second as JPEGs only
// Needs Chromium (Playwright) and ffmpeg with libx264 (FFMPEG env var or ffmpeg on PATH).
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const preview = process.argv.includes('--preview');
const outDir = process.env.TRAILER_TMP ?? join(process.cwd(), 'test-results', 'trailer');
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
const port = 4199;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'frames'), { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 60; i++) {
  try {
    const res = await fetch(`http://localhost:${port}/play/`);
    if (res.ok) break;
  } catch {
    /* not up yet */
  }
  await wait(500);
}

const exe = process.env.PW_CHROMIUM ?? (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.error('pageerror', e));
  await page.goto(`http://localhost:${port}/play/?trailer`);
  await page.waitForFunction(() => window.__trailer);
  const frames = await page.evaluate(() => window.__trailer.frames);
  const fps = await page.evaluate(() => window.__trailer.fps);
  console.log(`rendering ${frames} frames @ ${fps} fps${preview ? ' (preview)' : ''}`);
  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    await page.evaluate((n) => window.__trailer.frame(n), i);
    if (!preview || i % fps === 0) {
      await page.screenshot({ path: join(outDir, 'frames', `${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
    }
    if (i % 60 === 0) console.log(`frame ${i}/${frames}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  if (!preview) {
    const wav = await page.evaluate(() => window.__trailer.audio());
    writeFileSync(join(outDir, 'audio.wav'), Buffer.from(wav, 'base64'));
  }
} finally {
  await browser.close();
  server.kill();
}

if (!preview) {
  mkdirSync('public', { recursive: true });
  execFileSync(ffmpeg, [
    '-y', '-loglevel', 'error',
    '-framerate', '30', '-i', join(outDir, 'frames', '%05d.jpg'),
    '-i', join(outDir, 'audio.wav'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '160k', '-shortest',
    join('public', 'trailer.mp4'),
  ], { stdio: 'inherit' });
  // Poster: the hook frame (the stalker revealed by the first clap).
  copyFileSync(join(outDir, 'frames', '00030.jpg'), join('public', 'trailer-poster.jpg'));
  console.log('wrote public/trailer.mp4 and public/trailer-poster.jpg');
}
