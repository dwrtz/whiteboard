import { defineConfig } from "@playwright/test";
// Runs selected e2e specs against the live deployment (no local server).
export default defineConfig({
  testDir: "e2e-live", workers: 1, timeout: 90_000, expect: { timeout: 15_000 },
  use: { baseURL: "https://whiteboard.beef-able.com", viewport: { width: 1360, height: 860 }, timezoneId: "America/New_York", permissions: ["clipboard-read", "clipboard-write"], acceptDownloads: true },
});
