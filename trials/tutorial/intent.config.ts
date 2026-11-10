import { defineConfig, devices } from "@playwright/test";
import type { IntentOptions, IntentUseOptions } from "playwright-intent";
import { allow, fileStore, refuse } from "playwright-intent/file-store";

const intent = {
	// Steps come from .intent on Endform, so its runners need no model key.
	store: fileStore({
		updates: process.env.ENDFORM === "true" ? refuse() : allow(),
	}),
	model: process.env.INTENT_MODEL ?? "openai/gpt-6-luna",
} satisfies IntentOptions;

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
		intent,
	},
});
