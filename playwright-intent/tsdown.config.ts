import { defineConfig } from "tsdown";

export default defineConfig([
	{
		dts: {
			sourcemap: false,
		},
		entry: {
			index: "./src/index",
			"file-store": "./src/store/file-store",
			"remote-store": "./src/remote-store/remote-store",
			reporter: "./src/reporter/reporter",
		},
		fixedExtension: true,
		format: ["esm", "cjs"],
		// `test` is the default export too, like Playwright's.
		outputOptions: { exports: "named" },
	},
	{
		// The command only runs from a terminal, so it's ESM only.
		dts: {
			sourcemap: false,
		},
		entry: {
			cli: "./src/cli/cli",
			bin: "./src/cli/bin",
		},
		fixedExtension: true,
		format: ["esm"],
	},
]);
