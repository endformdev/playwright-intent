import { defineConfig } from "@playwright/test";

/**
 * Runs the flows in `test-e2e/flows`. These are not browser tests: each one
 * starts real Playwright runs of `test-e2e/project`. See `test-e2e/README.md`.
 */
export default defineConfig({
	testDir: "./test-e2e/flows",
	testMatch: "**/*.flow.ts",
	globalSetup: "./test-e2e/global-setup.ts",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	timeout: 120_000,
	reporter: process.env.CI ? "github" : "list",
});
