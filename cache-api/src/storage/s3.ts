import { AwsClient } from "aws4fetch";
import type { CacheApiStorage } from "./storage";

export interface StorageConfig {
	/** S3 bucket name */
	bucket: string;
	/** S3-compatible endpoint URL */
	endpoint: string;
	accessKeyId: string;
	secretAccessKey: string;
	/** AWS region (default: 'auto', works for R2) */
	region?: string;
}

/**
 * Create an S3-compatible storage implementation using aws4fetch.
 *
 * @example
 * ```ts
 * const storage = createS3Storage({
 *   bucket: 'intent-steps',
 *   endpoint: 'https://xxx.r2.cloudflarestorage.com',
 *   accessKeyId: env.R2_ACCESS_KEY_ID,
 *   secretAccessKey: env.R2_SECRET_ACCESS_KEY,
 * });
 * ```
 */
export function createS3Storage(config: StorageConfig): CacheApiStorage {
	const {
		bucket,
		endpoint,
		accessKeyId,
		secretAccessKey,
		region = "auto",
	} = config;
	const baseUrl = endpoint.replace(/\/$/, "");
	const aws = new AwsClient({
		accessKeyId,
		secretAccessKey,
		region,
		service: "s3",
	});
	const objectUrl = (path: string) =>
		`${baseUrl}/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;

	async function fail(
		method: string,
		path: string,
		response: Response,
	): Promise<never> {
		const text = await response.text();
		throw new Error(
			`S3 ${method} failed for ${path}: ${response.status} ${response.statusText} - ${text}`,
		);
	}

	return {
		async put(path, data, contentType) {
			const response = await aws.fetch(objectUrl(path), {
				method: "PUT",
				headers: { "Content-Type": contentType },
				body: data,
			});
			if (!response.ok) await fail("PUT", path, response);
		},

		async get(path) {
			const response = await aws.fetch(objectUrl(path), { method: "GET" });
			if (response.status === 404) return null;
			if (!response.ok) await fail("GET", path, response);
			return response.arrayBuffer();
		},

		async head(path) {
			const response = await aws.fetch(objectUrl(path), { method: "HEAD" });
			if (response.status === 404) return false;
			if (!response.ok) await fail("HEAD", path, response);
			return true;
		},

		async list(prefix) {
			const keys: string[] = [];
			let token: string | undefined;
			do {
				const url = new URL(`${baseUrl}/${bucket}`);
				url.searchParams.set("list-type", "2");
				url.searchParams.set("prefix", prefix);
				if (token) url.searchParams.set("continuation-token", token);
				const response = await aws.fetch(url.toString(), { method: "GET" });
				if (!response.ok) await fail("LIST", prefix, response);
				const xml = await response.text();
				for (const match of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
					keys.push(decodeXml(match[1] ?? ""));
				}
				token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(
					xml,
				)?.[1];
			} while (token);
			return keys.sort();
		},
	};
}

function decodeXml(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}
