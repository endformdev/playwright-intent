import fs from "node:fs/promises";
import path from "node:path";
import { deliverToPullRequest } from "../github/deliver";
import { ignoreMissing, writeFileAtomic } from "./local-files";
import type { IntentStore, IntentStoreProvider } from "./store";
import {
	type FileStoreUpdates,
	fileStoreUpdates,
	resolveUpdatePolicy,
} from "./update-policy";

export type { FileStoreUpdates, UpdatePolicy } from "./update-policy";
export { allow, commit, propose, refuse } from "./update-policy";

export interface FileStoreOptions {
	/** What happens when the agent would change a step. */
	updates: FileStoreUpdates;
}

/** Keeps steps in `.intent` beside the config, usually committed to Git. */
export function fileStore(options: FileStoreOptions): IntentStoreProvider {
	return {
		open: openFileStore,
		updates: (env) =>
			fileStoreUpdates(resolveUpdatePolicy(options.updates, env)),
		async deliver(input) {
			const { name } = resolveUpdatePolicy(options.updates, input.env);
			if (name === "commit" || name === "propose") {
				await deliverToPullRequest(name, input);
			}
		},
	};
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
