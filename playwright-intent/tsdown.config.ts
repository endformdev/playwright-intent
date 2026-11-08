import { defineConfig } from "tsdown";

export default defineConfig({
	dts: {
		sourcemap: false,
	},
	entry: {
		index: "./src/index",
		"file-store": "./src/store/file-store",
		reporter: "./src/reporter/reporter",
	},
	fixedExtension: true,
	format: ["esm", "cjs"],
});
