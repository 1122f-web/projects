import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the local stack:
//   npm run db:start && npm run db:reset && npm run seed:dev -w backend
// The dev servers are started automatically if they are not already running.
// Set PLAYWRIGHT_CHROMIUM_PATH to use an already installed Chromium.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions: { executablePath } } },
  ],
  webServer: [
    { command: 'npm run dev -w backend', cwd: '..', url: 'http://127.0.0.1:4000/api/health', reuseExistingServer: true, timeout: 60_000 },
    { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 60_000 },
  ],
});
