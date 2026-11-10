import type { CacheApiStorage } from "./storage";

/**
 * The parts of a Workers R2 binding the storage uses, so this package doesn't
 * need `@cloudflare/workers-types`. Pass the binding itself.
 */
export interface R2BucketBinding {
	put(
		key: string,
		value: ArrayBuffer,
		options?: { httpMetadata?: { contentType?: string } },
	): Promise<unknown>;
	get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
	head(key: string): Promise<unknown>;
	list(options?: { prefix?: string; cursor?: string }): Promise<{
		objects: { key: string }[];
		truncated: boolean;
		cursor?: string;
	}>;
}

/**
 * Uses an R2 bucket bound to a Cloudflare Worker, so the Worker needs no S3
 * credentials.
 *
 * @example
 * ```ts
 * const storage = createR2Storage(env.STEPS);
 * ```
 */
export function createR2Storage(bucket: R2BucketBinding): CacheApiStorage {
	return {
		async put(path, data, contentType) {
			await bucket.put(path, data, { httpMetadata: { contentType } });
		},

		async get(path) {
			const object = await bucket.get(path);
			return object ? object.arrayBuffer() : null;
		},

		async head(path) {
			return (await bucket.head(path)) !== null;
		},

		async list(prefix) {
			const keys: string[] = [];
			let cursor: string | undefined;
			do {
				const page = await bucket.list({ prefix, cursor });
				keys.push(...page.objects.map((object) => object.key));
				cursor = page.truncated ? page.cursor : undefined;
			} while (cursor);
			return keys.sort();
		},
	};
}
