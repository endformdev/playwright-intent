import { defineConfig, devices } from "@playwright/test";
import type { IntentUseOptions } from "playwright-intent";

export default defineConfig<IntentUseOptions>({
	testDir: "./tests-intent",
	outputDir: "./test-results-intent",
	timeout: 60_000,
	workers: 3,
	reporter: [["list"], ["json", { outputFile: "intent-report.json" }]],
	use: {
		...devices["Desktop Chrome"],
		baseURL:
			process.env.BASE_URL || "https://endform-playwright-tutorial.vercel.app",
		trace: "on",
		intent: {
			// Steps come from .intent on Endform, so its runners need no model key.
			mode: process.env.ENDFORM === "true" ? "none" : undefined,
			model: process.env.INTENT_MODEL ?? "openai/gpt-6-luna",
		},
	},
});
