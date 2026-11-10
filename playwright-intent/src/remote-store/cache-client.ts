import { IntentStoreError } from "../errors";

export interface CacheClientOptions {
	url: string;
	token?: string;
}

const TIMEOUT_MS = 60_000;

/** Talks to `@playwright-intent/cache-api`. */
export class CacheClient {
	readonly #url: string;
	readonly #token?: string;

	constructor({ url, token }: CacheClientOptions) {
		this.#url = url.replace(/\/+$/, "");
		this.#token = token;
	}

	/** Returns null when nothing has been stored yet. */
	async getMain(): Promise<Uint8Array | null> {
		const response = await this.#fetch("GET", "main");
		if (response.status === 404) return null;
		await this.#assertOk("download", response);
		return new Uint8Array(await response.arrayBuffer());
	}

	async putMain(zip: Uint8Array): Promise<void> {
		const response = await this.#fetch("PUT", "main", zip);
		await this.#assertOk("upload", response);
	}

	async #fetch(
		method: string,
		route: string,
		body?: Uint8Array,
	): Promise<Response> {
		const url = `${this.#url}/v1/zips/${route}`;
		try {
			return await fetch(url, {
				method,
				headers: {
					...(this.#token && { Authorization: `Bearer ${this.#token}` }),
					...(body && { "Content-Type": "application/zip" }),
				},
				body: body as BodyInit | undefined,
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
		} catch (error) {
			const verb = method === "GET" ? "download" : "upload";
			throw new IntentStoreError(
				`Couldn't ${verb} steps at ${url}: ${(error as Error).message}`,
			);
		}
	}

	async #assertOk(verb: string, response: Response): Promise<void> {
		if (response.ok) return;
		const text = (await response.text().catch(() => "")).slice(0, 500);
		const hint =
			response.status === 401 || response.status === 403
				? " Check the remote store's token."
				: "";
		throw new IntentStoreError(
			`Couldn't ${verb} steps at ${response.url}: ${response.status} ` +
				`${response.statusText} ${text}`.trim() +
				hint,
		);
	}
}
