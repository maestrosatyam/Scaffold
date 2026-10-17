// Playwright E2E config for the simulated Alexa+ surface (AC-16, AC-17).
//
//   npm run test:e2e                 # builds dist/ if src is newer, starts the server, runs tests/e2e
//   E2E_BUILD=1 npm run test:e2e     # force a rebuild first (E2E_BUILD=0 never builds)
//   E2E_BASE_URL=http://127.0.0.1:8787 npm run test:e2e   # test an already-running server instead
//
// The server is started by `webServer` with SCAFFOLD_STORE=memory on a free port, so a run never
// touches data/scaffold.db. @playwright/test is pinned to 1.64.1, whose Chromium revision (1248)
// matches the browser build already in ~/.cache/ms-playwright; on a machine without it, run
// `npx playwright install chromium` once.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const root = import.meta.dirname;

/** A free TCP port, chosen once in the runner process and inherited by the workers via env. */
function freePort(): string {
  const js = "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})";
  return execFileSync(process.execPath, ['-e', js], { encoding: 'utf8' }).trim();
}

/** Newest mtime under the given paths (files or directories). */
function newest(paths: string[]): number {
  let max = 0;
  const walk = (p: string) => {
    if (!existsSync(p)) return;
    const st = statSync(p);
    if (st.isDirectory()) for (const d of readdirSync(p)) walk(join(p, d));
    else max = Math.max(max, st.mtimeMs);
  };
  paths.forEach((p) => walk(join(root, p)));
  return max;
}

/** Build when forced, when dist/ is missing, or when the web/app sources are newer than the build. */
function needsBuild(): boolean {
  if (process.env.E2E_BUILD === '1') return true;
  if (process.env.E2E_BUILD === '0') return false;
  const outputs = ['dist/web/index.html', 'dist/apps/step-card.html'].map((p) => join(root, p));
  if (!outputs.every(existsSync)) return true;
  const built = Math.min(...outputs.map((p) => statSync(p).mtimeMs));
  return newest(['src/web', 'src/apps', 'vite.web.config.ts', 'scripts/build-apps.ts']) > built;
}

const external = process.env.E2E_BASE_URL?.replace(/\/$/, '');
const port = (process.env.E2E_PORT ??= freePort());
const baseURL = external ?? `http://127.0.0.1:${port}`;
const build = !external && needsBuild();

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // Each test creates its own demo sandbox; the server allows 20 per client IP per window.
  workers: process.env.CI ? 1 : 3,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['json', { outputFile: './test-results/e2e/results.json' }]],
  use: {
    baseURL,
    // Same canvas as the demo video, so the director/split layouts render as they do on camera.
    viewport: { width: 1920, height: 1080 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } }],
  webServer: external
    ? undefined
    : {
        command: `${build ? 'npm run build && ' : ''}node src/server/main.ts`,
        url: `${baseURL}/healthz`,
        cwd: root,
        env: {
          SCAFFOLD_STORE: 'memory',
          HOST: '127.0.0.1',
          PORT: port,
          // Ephemeral secret: never read or write data/.token-secret during tests.
          SCAFFOLD_TOKEN_SECRET: process.env.SCAFFOLD_TOKEN_SECRET ?? randomBytes(32).toString('hex'),
        },
        reuseExistingServer: false,
        timeout: build ? 180_000 : 30_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
