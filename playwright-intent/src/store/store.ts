import type { Changes } from "./changes";

/**
 * Where step source lives. Keys are relative, POSIX-style step paths.
 *
 * Code always runs from `.intent` on disk, because Playwright reads that file
 * for snippets and trace sources. A remote store fills `.intent` before each
 * import, so this stays a plain blob interface like `trace-api`'s storage.
 */
export interface IntentStore {
	get(key: string): Promise<string | null>;
	put(key: string, source: string): Promise<void>;
	delete(key: string): Promise<void>;
	list(prefix: string): Promise<string[]>;
}

/** What `use.intent.store` takes: a store, and what happens to its changes. */
export interface IntentStoreProvider {
	changes: Changes;
	/** Opens the store. `root` is the `.intent` folder beside the config. */
	open(root: string): IntentStore;
}
