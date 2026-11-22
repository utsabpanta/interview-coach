import { defineConfig } from "vitest/config";

// The web app has its own test run in web/.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
