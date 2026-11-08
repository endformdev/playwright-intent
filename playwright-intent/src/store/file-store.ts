import fs from "node:fs/promises";
import path from "node:path";
import type { Changes } from "./changes";
import type { IntentStore, IntentStoreProvider } from "./store";

/** Keeps steps in `.intent` beside the config, usually committed to Git. */
export function fileStore(options: { changes: Changes }): IntentStoreProvider {
	return { changes: options.changes, open: createFileStore };
}

function createFileStore(root: string): IntentStore {
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

/**
 * Writes through a temp file, so a step is never seen half written. Tests have
 * their own folders, so this only matters when the same test runs at once:
 * across browser projects, or with `--repeat-each`.
 */
export async function writeFileAtomic(
	file: string,
	contents: string,
): Promise<void> {
	await fs.mkdir(path.dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}.tmp`;
	await fs.writeFile(temp, contents);
	await fs.rename(temp, file);
}

/** Makes sure `.intent` on disk matches what the store returned. */
export async function materializeStep(
	file: string,
	source: string,
): Promise<void> {
	const existing = await fs.readFile(file, "utf8").catch(ignoreMissing);
	if (existing !== source) await writeFileAtomic(file, source);
}

function ignoreMissing(error: NodeJS.ErrnoException): null {
	if (error.code === "ENOENT") return null;
	throw error;
}
