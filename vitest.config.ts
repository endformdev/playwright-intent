import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: [
			"cache-api/test-unit/**/*.test.ts",
			"playwright-intent/test-unit/**/*.test.ts",
		],
	},
});
