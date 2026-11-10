import { defineConfig } from "tsdown";

export default defineConfig({
	dts: {
		sourcemap: false,
	},
	entry: {
		index: "./src/index",
		"file-system": "./src/storage/file-system",
	},
});
