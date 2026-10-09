import { defineConfig } from '@playwright/test';

const exe = process.env.PW_CHROMIUM ?? (process.env.CI ? undefined : '/opt/pw-browsers/chromium-1194/chrome-linux/chrome');

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  // CI has no GPU: software GL renders 2–4 fps, so state transitions take seconds of wall time.
  expect: { timeout: 15_000 },
  use: {
    // BASE_URL=https://… runs the same suite against a deployed build.
    baseURL: process.env.BASE_URL ?? 'http://localhost:4173',
    viewport: { width: 1280, height: 720 },
    locale: 'ru-RU',
    launchOptions: {
      executablePath: exe,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm run preview',
        url: 'http://localhost:4173',
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
