import fs from "node:fs/promises";
import path from "node:path";
import type { IntentStore } from "playwright-intent";

/** Stands in for R2 or an API: slow, async, and not the `.intent` folder. */
export function createRemoteStore(directory: string): IntentStore {
	const resolve = (key: string) => path.join(directory, ...key.split("/"));
	const delay = () => new Promise((done) => setTimeout(done, 20));

	return {
		async get(key) {
			await delay();
			return fs.readFile(resolve(key), "utf8").catch(() => null);
		},
		async put(key, source) {
			await delay();
			await fs.mkdir(path.dirname(resolve(key)), { recursive: true });
			await fs.writeFile(resolve(key), source);
		},
		async delete(key) {
			await delay();
			await fs.rm(resolve(key), { force: true });
		},
	};
}
