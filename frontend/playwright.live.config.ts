import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const data = mkdtempSync(join(tmpdir(), "xhs-live-test-"));
const backendEnv = {
  XHS_EXTRA_ORIGIN: "http://127.0.0.1:5176",
  XHS_DATA_DIR: data,
  XHS_MODEL_NAME: "",
  XHS_MODEL_API_KEY: "",
  XHS_MODEL_BASE_URL: "",
  XHS_MCP_URL: "http://127.0.0.1:9/mcp",
};
export default defineConfig({
  testDir: "./tests",
  testMatch: "live.spec.ts",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:5176",
    viewport: { width: 1440, height: 1000 },
  },
  webServer: [
    {
      command:
        "../backend/.venv/bin/python -m uvicorn xhs_content_agent.app:app --host 127.0.0.1 --port 18081",
      url: "http://127.0.0.1:18081/api/v1/health",
      env: backendEnv,
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --port 5176",
      url: "http://127.0.0.1:5176",
      env: { VITE_DATA_MODE: "live", XHS_API_PROXY: "http://127.0.0.1:18081" },
      reuseExistingServer: false,
    },
  ],
  reporter: "list",
});
