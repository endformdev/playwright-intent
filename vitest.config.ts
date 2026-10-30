import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["playwright-intent/src/**/*.{test,spec}.{ts,tsx}"],
	},
});
