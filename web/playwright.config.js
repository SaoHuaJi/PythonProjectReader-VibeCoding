import {defineConfig} from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 180000,
  expect: {timeout: 15000},
  workers: 1,
  maxFailures: 1,
  fullyParallel: false,
  reporter: "list",
  outputDir: "../work/runtime/e2e-results",
  preserveOutput: "failures-only",
  use: {
    baseURL: process.env.PROJECTREADER_BASE_URL || "http://127.0.0.1:8765",
    channel: "msedge",
    headless: true,
    actionTimeout: 15000,
    viewport: {width: 1500, height: 1050},
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
