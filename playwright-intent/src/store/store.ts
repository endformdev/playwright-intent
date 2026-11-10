import type { ChangeSet } from "../reporter/change-set";

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
}

/** What a store lets one run do with step changes. */
export interface StepUpdates {
	/** No step can change, so the agent never starts. */
	refused: boolean;
	/**
	 * The reporter delivers this run's changes, so each one is attached to its
	 * test, and the reporter needs the intent options.
	 */
	delivered: boolean;
	/** A change only lasts once someone applies it, so its test stays red. */
	awaitsReview: boolean;
}

/** What the reporter hands a store at the end of a run. */
export interface DeliveryInput {
	changes: ChangeSet;
	/** The `.intent` folder. */
	root: string;
	env: NodeJS.ProcessEnv;
	/** One shard only sees part of a run, so merge-reports delivers instead. */
	sharded: boolean;
}

/** What `store` takes in the intent options. */
export interface IntentStoreProvider {
	/** Opens the store in a worker. `root` is the `.intent` folder. */
	open(root: string): IntentStore;
	/** Decides what this run may do with step changes. */
	updates(env: NodeJS.ProcessEnv): StepUpdates;
	/** Runs in the reporter, and throws if something couldn't be delivered. */
	deliver?(input: DeliveryInput): Promise<void>;
}
