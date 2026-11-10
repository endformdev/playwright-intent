import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defineMiddleware, H3, HTTPError } from "h3";
import { afterEach, describe, expect, it } from "vitest";
import {
	branchZip,
	type CacheApiStorage,
	createCacheApi,
	createZipsHandler,
	ZIPS_PATH,
} from "../src/index";
import { createFileSystemStorage } from "../src/storage/file-system";

const EMPTY_ZIP = new Uint8Array([
	0x50,
	0x4b,
	0x05,
	0x06,
	...Array.from({ length: 18 }, () => 0),
]);
const directories: string[] = [];

async function storage(): Promise<CacheApiStorage> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cache-api-"));
	directories.push(directory);
	return createFileSystemStorage(directory);
}

function request(app: H3, route: string, init?: RequestInit) {
	return app.fetch(new Request(`http://localhost/v1/zips/${route}`, init));
}

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => fs.rm(directory, { recursive: true, force: true })),
	);
});

describe("cache API", () => {
	it("returns 404 before anything is stored", async () => {
		const app = createCacheApi({ storage: await storage() });

		const response = await request(app, "main");

		expect(response.status).toBe(404);
	});

	it("stores main.zip and serves it back", async () => {
		const store = await storage();
		const app = createCacheApi({ storage: store });

		const put = await request(app, "main", { method: "PUT", body: EMPTY_ZIP });
		const get = await request(app, "main");

		expect(put.status).toBe(204);
		expect(get.status).toBe(200);
		expect(get.headers.get("content-type")).toBe("application/zip");
		expect(new Uint8Array(await get.arrayBuffer())).toEqual(EMPTY_ZIP);
		expect(await store.list("")).toEqual(["main.zip"]);
	});

	it("keeps each branch in its own zip", async () => {
		const store = await storage();
		const app = createCacheApi({ storage: store });
		const branch = "fix/rename link";

		await request(app, `branches/${encodeURIComponent(branch)}`, {
			method: "PUT",
			body: EMPTY_ZIP,
		});

		expect(await store.list("branches/")).toEqual([branchZip(branch)]);
		expect(branchZip(branch)).toBe("branches/Zml4L3JlbmFtZSBsaW5r.zip");
		expect((await request(app, "main")).status).toBe(404);
		const get = await request(app, `branches/${encodeURIComponent(branch)}`);
		expect(get.status).toBe(200);
	});

	it("rejects a body that isn't a zip", async () => {
		const app = createCacheApi({ storage: await storage() });

		const put = await request(app, "main", { method: "PUT", body: "steps" });

		expect(put.status).toBe(400);
		expect((await request(app, "main")).status).toBe(404);
	});

	it("only serves main and branches", async () => {
		const app = createCacheApi({ storage: await storage() });

		expect((await request(app, "other")).status).toBe(404);
		expect((await request(app, "branches/")).status).toBe(404);
	});

	it("stores each tenant's zips under resolvePath", async () => {
		const store = await storage();
		const app = createCacheApi({
			storage: store,
			resolvePath: (event, file) =>
				`${event.req.headers.get("x-tenant")}/${file}`,
		});

		await request(app, "main", {
			method: "PUT",
			body: EMPTY_ZIP,
			headers: { "x-tenant": "acme" },
		});

		expect(await store.list("")).toEqual(["acme/main.zip"]);
		const other = await request(app, "main", { headers: { "x-tenant": "b" } });
		expect(other.status).toBe(404);
	});

	it("composes with authentication middleware", async () => {
		const store = await storage();
		const app = new H3();
		app.use(
			ZIPS_PATH,
			defineMiddleware((event) => {
				const header = event.req.headers.get("authorization");
				if (header !== "Bearer secret") {
					throw new HTTPError({ status: 401, message: "Unauthorized" });
				}
			}),
		);
		app.get(ZIPS_PATH, createZipsHandler({ storage: store }));
		app.put(ZIPS_PATH, createZipsHandler({ storage: store }));

		const refused = await request(app, "main", {
			method: "PUT",
			body: EMPTY_ZIP,
		});
		const allowed = await request(app, "main", {
			method: "PUT",
			body: EMPTY_ZIP,
			headers: { authorization: "Bearer secret" },
		});

		expect(refused.status).toBe(401);
		expect(allowed.status).toBe(204);
	});
});
