export class GitHubError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

export interface GitHubOptions {
	apiUrl: string;
	token: string;
	repository: string;
}

/** Only what delivering a change needs, so it doesn't need a dependency. */
export class GitHub {
	readonly #options: GitHubOptions;

	constructor(options: GitHubOptions) {
		this.#options = options;
	}

	async json<T>(method: string, route: string, body?: unknown): Promise<T> {
		const response = await this.#send(method, route, body);
		return (await response.json()) as T;
	}

	/** A file's text at a commit, or null when it isn't there. */
	async readFile(file: string, ref: string): Promise<string | null> {
		try {
			const route = `contents/${encodePath(file)}?ref=${ref}`;
			const response = await this.#send(
				"GET",
				route,
				undefined,
				"application/vnd.github.raw+json",
			);
			return await response.text();
		} catch (error) {
			if (error instanceof GitHubError && error.status === 404) return null;
			throw error;
		}
	}

	async #send(
		method: string,
		route: string,
		body?: unknown,
		accept = "application/vnd.github+json",
	): Promise<Response> {
		const { apiUrl, token, repository } = this.#options;
		const response = await fetch(`${apiUrl}/repos/${repository}/${route}`, {
			method,
			headers: {
				accept,
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
				"x-github-api-version": "2022-11-28",
			},
			...(body !== undefined && { body: JSON.stringify(body) }),
		});
		if (!response.ok) {
			throw new GitHubError(
				`${method} ${route} returned ${response.status}: ${await response.text()}`,
				response.status,
			);
		}
		return response;
	}
}

export function encodePath(file: string): string {
	return file.split("/").map(encodeURIComponent).join("/");
}
