import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "studio.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:5175",
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "npm run dev -- --port 5175",
    env: { VITE_DATA_MODE: "demo" },
    url: "http://127.0.0.1:5175",
    reuseExistingServer: false,
  },
  reporter: "list",
});
