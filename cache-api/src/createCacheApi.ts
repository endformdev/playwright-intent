import { H3, type H3Event } from "h3";
import { ZIPS_PATH } from "./api";
import { createZipsHandler } from "./handlers/zips";
import { createS3Storage, type StorageConfig } from "./storage/s3";
import type { CacheApiStorage } from "./storage/storage";

export interface CacheApiConfig {
	/** Where zips are kept. Use this or `storageConfig`. */
	storage?: CacheApiStorage;
	/** Creates S3-compatible storage. Use this or `storage`. */
	storageConfig?: StorageConfig;
	/** Changes a storage path before it's read or written, e.g. per tenant. */
	resolvePath?: (event: H3Event, path: string) => Promise<string> | string;
	/** CORS origin. Defaults to false, which sends no CORS headers. */
	corsOrigin?: string | false;
}

/** What each handler receives, once storage is resolved. */
export interface CacheApiHandlerConfig {
	storage: CacheApiStorage;
	resolvePath?: (event: H3Event, path: string) => Promise<string> | string;
	corsOrigin?: string | false;
}

/**
 * Creates the cache API, with `GET` and `PUT` on `/v1/zips/**`. It doesn't
 * authenticate requests, so add your own middleware. See the README.
 */
export function createCacheApi(config: CacheApiConfig): H3 {
	const storage =
		config.storage ??
		(config.storageConfig && createS3Storage(config.storageConfig));
	if (!storage) {
		throw new Error("Pass createCacheApi either storage or storageConfig.");
	}

	const handler = createZipsHandler({
		storage,
		resolvePath: config.resolvePath,
		corsOrigin: config.corsOrigin,
	});
	const app = new H3();
	app.get(ZIPS_PATH, handler);
	app.put(ZIPS_PATH, handler);
	if (config.corsOrigin) app.options(ZIPS_PATH, handler);
	return app;
}
