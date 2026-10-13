import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["pw-ai/src/**/*.{test,spec}.{ts,tsx}"],
	},
});
