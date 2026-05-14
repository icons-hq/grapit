import { defineConfig, devices } from '@playwright/test';

const port = process.env['PLAYWRIGHT_PORT'] ?? '3000';
const baseURL = process.env['PLAYWRIGHT_BASE_URL'] ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // API (8080) is started separately — locally by the developer's root-level
  // `pnpm dev` (turbo), in CI by a dedicated background step that redirects
  // logs to a file for easier debugging. Playwright only manages the web dev
  // server here so we don't have to fight webServer.env capture semantics.
  webServer: {
    command: `pnpm --filter @grabit/web exec next dev --turbopack --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    env: {
      // Propagate Toss test key to the dev server so the SDK can initialize.
      // Phase 9 DEBT-05 / REVIEWS.md HIGH-01.
      NEXT_PUBLIC_TOSS_CLIENT_KEY:
        process.env['TOSS_CLIENT_KEY_TEST'] ??
        process.env['NEXT_PUBLIC_TOSS_CLIENT_KEY'] ??
        '',
    },
  },
});
