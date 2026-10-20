import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({ resolve: { alias: { "@": resolve("src") } }, test: { include: ["tests/integration/**/*.test.ts"], testTimeout: 20_000, fileParallelism: false } });
