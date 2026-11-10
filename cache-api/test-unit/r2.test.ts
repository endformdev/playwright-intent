import { describe, expect, it } from "vitest";
import { createCacheApi, createR2Storage, type R2BucketBinding } from "../src";

/** Behaves like a Workers R2 binding, with a page size of two. */
function fakeBucket(): R2BucketBinding & { types: Map<string, string> } {
	const objects = new Map<string, ArrayBuffer>();
	const types = new Map<string, string>();
	return {
		types,
		async put(key, value, options) {
			objects.set(key, value);
			types.set(key, options?.httpMetadata?.contentType ?? "");
		},
		async get(key) {
			const value = objects.get(key);
			return value ? { arrayBuffer: async () => value } : null;
		},
		async head(key) {
			return objects.has(key) ? {} : null;
		},
		async list({ prefix = "", cursor } = {}) {
			const keys = [...objects.keys()].filter((key) => key.startsWith(prefix));
			const start = Number(cursor ?? 0);
			const page = keys.slice(start, start + 2);
			const truncated = start + 2 < keys.length;
			return {
				objects: page.map((key) => ({ key })),
				truncated,
				...(truncated && { cursor: String(start + 2) }),
			};
		},
	};
}

const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

describe("R2 storage", () => {
	it("serves what the API stored through the binding", async () => {
		const bucket = fakeBucket();
		const app = createCacheApi({ storage: createR2Storage(bucket) });
		const url = "http://localhost/v1/zips/main";

		expect((await app.fetch(new Request(url))).status).toBe(404);
		await app.fetch(new Request(url, { method: "PUT", body: ZIP }));
		const response = await app.fetch(new Request(url));

		expect(new Uint8Array(await response.arrayBuffer())).toEqual(ZIP);
		expect(bucket.types.get("main.zip")).toBe("application/zip");
	});

	it("lists every page", async () => {
		const storage = createR2Storage(fakeBucket());
		for (const key of ["a/1", "a/2", "a/3", "b/1"]) {
			await storage.put(key, ZIP.buffer, "application/zip");
		}

		expect(await storage.list("a/")).toEqual(["a/1", "a/2", "a/3"]);
		expect(await storage.head("a/3")).toBe(true);
		expect(await storage.head("c")).toBe(false);
	});
});
