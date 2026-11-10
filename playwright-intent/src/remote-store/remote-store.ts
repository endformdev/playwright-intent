import { isReadOnlyPullRequest } from "../github/pull-request";
import { openFileStore } from "../store/file-store";
import type {
	IntentStore,
	IntentStoreProvider,
	StepUpdates,
} from "../store/store";
import { CacheClient } from "./cache-client";
import { downloadSteps, waitForDownload } from "./download";
import { applyChanges, readStepZip, writeStepZip } from "./step-zip";

/** Where a remote store saves the changes from a run. */
export interface RemoteStoreUpdates {
	readonly name: "shared";
}

export interface RemoteStoreOptions {
	/** Where `@playwright-intent/cache-api` is served. */
	url: string;
	/** Sent as a bearer token. Only the API sees it. */
	token?: string;
	/** Where each run's changes are saved. */
	updates: RemoteStoreUpdates;
}

/** Every branch reads and writes the same steps, and the last upload wins. */
export function shared(): RemoteStoreUpdates {
	return { name: "shared" };
}

function log(message: string): void {
	console.log(`[intent] ${message}`);
}

/**
 * Keeps steps in `@playwright-intent/cache-api`. The reporter fills `.intent`
 * before tests run, and CI runs upload the changes from passing tests.
 */
export function remoteStore(options: RemoteStoreOptions): IntentStoreProvider {
	const client = new CacheClient(options);
	const updates = (env: NodeJS.ProcessEnv): StepUpdates => ({
		refused: false,
		// Forks have no secrets, so they have nothing to upload with.
		delivered: Boolean(env.CI) && !isReadOnlyPullRequest(env),
		awaitsReview: false,
	});

	return {
		prepare: ({ root, env }) => downloadSteps(client, root, env),
		open: (root) => openDownloadedStore(root),
		updates,
		async deliver({ changes, env, sharded }) {
			if (!updates(env).delivered || changes.passed.length === 0) return;
			if (sharded) {
				log(
					"Not uploading from one shard of a run. Run playwright merge-reports " +
						"to upload the whole run.",
				);
				return;
			}
			const stored = await client.getMain();
			const files = applyChanges(
				stored ? readStepZip(stored) : new Map(),
				changes.passed,
			);
			await client.putMain(writeStepZip(files));
			log(
				`Uploaded ${changes.passed.length} step change(s), ${files.size} ` +
					"step(s) in all.",
			);
		},
	};
}

/** `.intent` on disk, once the reporter has filled it. */
function openDownloadedStore(root: string): IntentStore {
	const store = openFileStore(root);
	const ready = () => waitForDownload(process.env);
	return {
		async get(key) {
			await ready();
			return store.get(key);
		},
		async put(key, source) {
			await ready();
			return store.put(key, source);
		},
		async delete(key) {
			await ready();
			return store.delete(key);
		},
	};
}
