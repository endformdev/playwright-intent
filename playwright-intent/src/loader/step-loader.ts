import fs from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import { INTENT_DIRECTORY } from "../step/step-path";

const REGISTERED = Symbol.for("playwright-intent.step-loader");
const STEP_PATH_SEGMENT = `/${INTENT_DIRECTORY}/`;

/**
 * Loads `.intent/*.ts` without Playwright's Babel transform.
 *
 * Babel shifts line numbers, and for files imported during a test Playwright
 * can't map them back, so traces point at the wrong line. Stripping types
 * replaces them with spaces, which keeps every line where it was. Node runs
 * the most recently registered hook first, so this goes before Playwright's.
 */
export function registerStepLoader(): void {
	const state = globalThis as { [REGISTERED]?: boolean };
	if (state[REGISTERED]) return;
	state[REGISTERED] = true;

	registerHooks({
		load(url, context, nextLoad) {
			if (!isStepUrl(url)) return nextLoad(url, context);
			const source = fs.readFileSync(fileURLToPath(url), "utf8");
			return {
				format: "module",
				shortCircuit: true,
				source: stripTypeScriptTypes(source),
			};
		},
	});
}

function isStepUrl(url: string): boolean {
	return (
		url.startsWith("file:") &&
		url.includes(STEP_PATH_SEGMENT) &&
		url.endsWith(".ts")
	);
}
