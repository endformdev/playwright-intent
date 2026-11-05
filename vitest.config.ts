import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["playwright-intent/test-unit/**/*.test.ts"],
	},
});
