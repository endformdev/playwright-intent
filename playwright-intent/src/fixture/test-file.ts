import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { TestFile } from "../agent/agent";
import type { TestScope } from "./test-scope";

/**
 * Finds the line in `file` that led to this call. Call it synchronously from
 * `ai.do`, because the stack no longer reaches the test after a step starts.
 * A call from a helper in another file resolves to the helper's call site.
 */
export function callLineIn(file: string): number | undefined {
	const locations = [file, pathToFileURL(file).href];

	for (const frame of new Error().stack?.split("\n") ?? []) {
		for (const location of locations) {
			const [, afterFile] = frame.split(`${location}:`);
			const line = afterFile?.match(/^(\d+):\d+/)?.[1];
			if (line) return Number(line);
		}
	}
	return undefined;
}

export async function readTestFile(
	scope: TestScope,
	line: number | undefined,
): Promise<TestFile> {
	return {
		path: scope.testFile,
		source: await fs.readFile(scope.testInfo.file, "utf8"),
		line,
	};
}
