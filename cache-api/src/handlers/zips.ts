import {
	defineEventHandler,
	type EventHandler,
	getRouterParam,
	HTTPError,
} from "h3";
import { branchZip, MAIN_ZIP } from "../api";
import { applyCors } from "../cors";
import type { CacheApiHandlerConfig } from "../createCacheApi";

const ZIP_TYPE = "application/zip";
/** Every zip, even an empty one, starts with a local file or end record. */
const ZIP_SIGNATURES = [
	[0x50, 0x4b, 0x03, 0x04],
	[0x50, 0x4b, 0x05, 0x06],
];

/**
 * Serves and stores the step zips, for `GET` and `PUT` on `ZIPS_PATH`:
 * - `/v1/zips/main` is `main.zip`
 * - `/v1/zips/branches/{branch}` is that branch's zip. Encode the branch name
 *   with `encodeURIComponent`.
 *
 * @example
 * ```ts
 * app.get(ZIPS_PATH, createZipsHandler({ storage }));
 * app.put(ZIPS_PATH, createZipsHandler({ storage }));
 * ```
 */
export function createZipsHandler(config: CacheApiHandlerConfig): EventHandler {
	const { storage } = config;

	return defineEventHandler(async (event) => {
		const corsResponse = applyCors(event, config.corsOrigin);
		if (corsResponse) return corsResponse;

		let storagePath = zipPath(getRouterParam(event, "_") ?? "");
		if (config.resolvePath) {
			storagePath = await config.resolvePath(event, storagePath);
		}

		if (event.req.method === "GET") {
			const zip = await storage.get(storagePath);
			if (zip === null) {
				throw new HTTPError({ status: 404, message: "No steps stored yet" });
			}
			return new Response(zip, {
				headers: { "Content-Type": ZIP_TYPE, "Cache-Control": "no-store" },
			});
		}

		if (event.req.method === "PUT") {
			const zip = await event.req.arrayBuffer();
			if (!isZip(zip)) {
				throw new HTTPError({ status: 400, message: "The body isn't a zip" });
			}
			await storage.put(storagePath, zip, ZIP_TYPE);
			return new Response(null, { status: 204 });
		}

		throw new HTTPError({ status: 405, message: "Use GET or PUT" });
	});
}

/** Maps the path after `/v1/zips/` to where its zip is stored. */
function zipPath(route: string): string {
	if (route === "main") return MAIN_ZIP;
	const branch = route.startsWith("branches/")
		? decodeBranch(route.slice("branches/".length))
		: "";
	if (!branch) throw new HTTPError({ status: 404, message: "Not found" });
	return branchZip(branch);
}

function decodeBranch(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		throw new HTTPError({ status: 400, message: "Bad branch name" });
	}
}

function isZip(data: ArrayBuffer): boolean {
	const start = new Uint8Array(data, 0, Math.min(4, data.byteLength));
	return ZIP_SIGNATURES.some((signature) =>
		signature.every((byte, index) => start[index] === byte),
	);
}
