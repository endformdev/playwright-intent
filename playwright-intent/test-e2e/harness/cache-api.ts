import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import {
	type CacheApiStorage,
	createCacheApi,
	createS3Storage,
} from "@playwright-intent/cache-api";
import { createFileSystemStorage } from "@playwright-intent/cache-api/file-system";
import { strFromU8, unzipSync } from "fflate";

/**
 * The real `@playwright-intent/cache-api` on a local port, with a bearer token
 * in front of it like a deployment would have. It keeps zips in a folder, or
 * in a real bucket when `INTENT_E2E_S3_BUCKET` and the variables below are set.
 */
export class LocalCacheApi {
	static readonly TOKEN = "cache-token";

	/** Each request as `METHOD route status`, like `GET main 404`. */
	readonly requests: string[] = [];
	/** Answers every request with a 500, like an outage. */
	outage = false;

	readonly #server: http.Server;
	readonly #storage: CacheApiStorage;
	readonly #directory: string;
	/** Keeps each flow's zips apart in a shared bucket. */
	readonly #prefix: string;

	private constructor(
		server: http.Server,
		storage: CacheApiStorage,
		directory: string,
		prefix: string,
	) {
		this.#server = server;
		this.#storage = storage;
		this.#directory = directory;
		this.#prefix = prefix;
	}

	/** @param directory Where zips go, or a unique prefix in a bucket. */
	static async start(directory: string): Promise<LocalCacheApi> {
		const bucket = s3Storage();
		const storage = bucket ?? createFileSystemStorage(directory);
		const prefix = bucket
			? `e2e-${Date.now()}/${path.basename(directory)}/`
			: "";
		const app = createCacheApi({
			storage,
			resolvePath: (_event, file) => `${prefix}${file}`,
		});
		const server = http.createServer();
		const api = new LocalCacheApi(server, storage, directory, prefix);

		server.on("request", async (request, response) => {
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(chunk as Buffer);
			const method = request.method ?? "GET";
			const route = (request.url ?? "").replace(/^\/v1\/zips\//, "");

			let status: number;
			let body: Uint8Array | undefined;
			let type: string | null = null;
			if (api.outage) {
				status = 500;
			} else if (
				request.headers.authorization !== `Bearer ${LocalCacheApi.TOKEN}`
			) {
				status = 401;
			} else {
				const answer = await app.fetch(
					new Request(`http://localhost${request.url}`, {
						method,
						headers: request.headers as Record<string, string>,
						body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
					}),
				);
				status = answer.status;
				type = answer.headers.get("content-type");
				body = new Uint8Array(await answer.arrayBuffer());
			}
			api.requests.push(`${method} ${route} ${status}`);
			response.statusCode = status;
			if (type) response.setHeader("content-type", type);
			response.end(body);
		});
		await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
		return api;
	}

	get url(): string {
		return `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
	}

	/** The steps in `main.zip`, by key. */
	async steps(): Promise<Record<string, string>> {
		const zip = await this.#storage.get(`${this.#prefix}main.zip`);
		if (!zip) return {};
		return Object.fromEntries(
			Object.entries(unzipSync(new Uint8Array(zip))).map(([key, data]) => [
				key,
				strFromU8(data),
			]),
		);
	}

	async close(): Promise<void> {
		await new Promise((done) => this.#server.close(done));
	}

	async cleanUp(): Promise<void> {
		await fs.rm(this.#directory, { recursive: true, force: true });
	}
}

/** A real bucket, so the flows can run against S3, R2 or a local S3 server. */
function s3Storage(): CacheApiStorage | null {
	const {
		INTENT_E2E_S3_BUCKET,
		INTENT_E2E_S3_ENDPOINT,
		INTENT_E2E_S3_ACCESS_KEY_ID,
		INTENT_E2E_S3_SECRET_ACCESS_KEY,
		INTENT_E2E_S3_REGION,
	} = process.env;
	if (!INTENT_E2E_S3_BUCKET) return null;
	return createS3Storage({
		bucket: INTENT_E2E_S3_BUCKET,
		endpoint: INTENT_E2E_S3_ENDPOINT ?? "",
		accessKeyId: INTENT_E2E_S3_ACCESS_KEY_ID ?? "",
		secretAccessKey: INTENT_E2E_S3_SECRET_ACCESS_KEY ?? "",
		region: INTENT_E2E_S3_REGION,
	});
}
