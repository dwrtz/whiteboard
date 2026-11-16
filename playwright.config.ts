import { defineConfig } from "@playwright/test";
const PORT = 3210;
// Runs the real Worker under `wrangler dev` with fresh local R2 and Durable Object storage in .e2e/.
const serve = [
  "rm -rf .e2e",
  "npm run build",
  `npx wrangler dev --port ${PORT} --ip 127.0.0.1 --persist-to .e2e --show-interactive-dev-session=false`,
].join(" && ");
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 1360, height: 860 }, timezoneId: "America/New_York", permissions: ["clipboard-read", "clipboard-write"], acceptDownloads: true },
  webServer: { command: serve, url: `http://127.0.0.1:${PORT}/api/health`, reuseExistingServer: false, timeout: 180_000 },
});
