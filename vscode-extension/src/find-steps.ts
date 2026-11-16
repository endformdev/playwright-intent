import fs from "node:fs";
import path from "node:path";
import { parseStepCode } from "../../playwright-intent/src/step/step-file";
import {
	INTENT_DIRECTORY,
	slugify,
	stepKey,
} from "../../playwright-intent/src/step/step-path";
import type { IntentCall } from "./intent-call";

export interface StepFile {
	path: string;
	/** Relative to `.intent`, as the hover shows it. */
	key: string;
	/** The statements, without the function around them. */
	code: string;
	/** The zero-based line of the first statement. */
	codeLine: number;
}

/**
 * The step a call runs. That's one file when the titles are known and the
 * step exists. Otherwise it's every step with this intent, those for this test
 * file first.
 */
export function findSteps(
	testPath: string,
	call: Pick<IntentCall, "intent" | "titles">,
): StepFile[] {
	const root = intentRoot(path.dirname(testPath));
	if (!root) return [];
	const testFile = path.relative(path.dirname(root), testPath);

	if (call.titles) {
		const key = stepKey({ testFile, titles: call.titles, intent: call.intent });
		const step = readStep(root, key);
		if (step) return [step];
	}

	const name = `${slugify(call.intent)}.ts`;
	const keys = fs
		.readdirSync(root, { recursive: true, encoding: "utf8" })
		.filter((file) => path.basename(file) === name)
		.map((file) => file.split(path.sep).join("/"))
		.sort();
	const prefix = `${testFile.split(path.sep).map(slugify).join("/")}/`;
	const inTestFile = keys.filter((key) => key.startsWith(prefix));

	return (inTestFile.length > 0 ? inTestFile : keys).flatMap(
		(key) => readStep(root, key) ?? [],
	);
}

/** The nearest `.intent` folder above the test file. */
function intentRoot(directory: string): string | undefined {
	const candidate = path.join(directory, INTENT_DIRECTORY);
	if (fs.statSync(candidate, { throwIfNoEntry: false })?.isDirectory()) {
		return candidate;
	}
	const parent = path.dirname(directory);
	return parent === directory ? undefined : intentRoot(parent);
}

function readStep(root: string, key: string): StepFile | undefined {
	const stepPath = path.join(root, ...key.split("/"));
	if (!fs.existsSync(stepPath)) return undefined;

	const source = fs.readFileSync(stepPath, "utf8");
	const header = source.indexOf("Promise<void> {\n");
	return {
		path: stepPath,
		key,
		code: parseStepCode(source).trim(),
		codeLine: header === -1 ? 0 : source.slice(0, header).split("\n").length,
	};
}
