import { defineConfig } from "tsdown";

export default defineConfig({
	entry: { extension: "./src/extension" },
	format: "cjs",
	fixedExtension: true,
	platform: "node",
	// VS Code installs no dependencies, so the TypeScript parser ships inside.
	deps: { neverBundle: ["vscode"] },
	minify: true,
	dts: false,
});
