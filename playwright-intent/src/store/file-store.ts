import fs from "node:fs/promises";
import path from "node:path";
import type { Changes } from "./changes";
import { ignoreMissing, writeFileAtomic } from "./local-files";
import type { IntentStore, IntentStoreProvider } from "./store";

export type {
	ChangeCheck,
	ChangeDelivery,
	ChangePolicy,
	Changes,
	NamedChangePolicy,
	StepChange,
} from "./changes";
export { allow, commit, propose, refuse } from "./changes";

/** Keeps steps in `.intent` beside the config, usually committed to Git. */
export function fileStore(options: { changes: Changes }): IntentStoreProvider {
	return { changes: options.changes, open: openFileStore };
}

/**
 * The store on its own, for code that runs outside a test. It doesn't load
 * Playwright, so a CI script can use it.
 *
 * @param root The `.intent` folder.
 */
export function openFileStore(root: string): IntentStore {
	const resolve = (key: string) => path.join(root, ...key.split("/"));

	return {
		async get(key) {
			return fs.readFile(resolve(key), "utf8").catch(ignoreMissing);
		},
		async put(key, source) {
			await writeFileAtomic(resolve(key), source);
		},
		async delete(key) {
			await fs.rm(resolve(key), { force: true });
		},
	};
}
