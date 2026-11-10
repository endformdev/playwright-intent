import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { RunChange } from "../reporter/change-set";
import { isStepKey } from "../store/change-record";

/** Step sources by key, as they're kept in a zip. */
export type StepFiles = Map<string, string>;

/** Skips anything that isn't a step inside `.intent`. */
export function readStepZip(zip: Uint8Array): StepFiles {
	const files: StepFiles = new Map();
	for (const [name, data] of Object.entries(unzipSync(zip))) {
		if (name.endsWith("/") || !isStepKey(name)) continue;
		files.set(name, strFromU8(data));
	}
	return files;
}

export function writeStepZip(files: StepFiles): Uint8Array {
	const entries = [...files.keys()]
		.sort()
		.map((key) => [key, strToU8(files.get(key) ?? "")] as const);
	return zipSync(Object.fromEntries(entries));
}

/** Writes and deletes each change on top of what was stored. */
export function applyChanges(
	files: StepFiles,
	changes: RunChange[],
): StepFiles {
	const next = new Map(files);
	for (const change of changes) {
		if (change.kind === "write" && change.source !== undefined) {
			next.set(change.key, change.source);
		} else {
			next.delete(change.key);
		}
	}
	return next;
}

/** A test's folder: the step key without the step's file name. */
export function testFolder(key: string): string {
	return key.slice(0, key.lastIndexOf("/"));
}
