import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./tests/e2e", testIgnore: ["legacy/**"], fullyParallel: false, workers: 1, use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", channel: "msedge", trace: "retain-on-failure" }, reporter: "list" });
