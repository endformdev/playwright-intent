import http from "node:http";
import type { AddressInfo } from "node:net";

export interface TreeEntry {
	path: string;
	content?: string;
	sha?: null;
}

interface Comment {
	id: number;
	body: string;
	user: { type: string };
}

/** The parts of GitHub's REST API that delivery uses, for one pull request. */
export class FakeGitHub {
	static readonly REPOSITORY = "acme/shop";
	static readonly NUMBER = 7;
	static readonly HEAD_REF = "fix/rename-link";
	static readonly HEAD_SHA = "aaaaaaa1111";

	readonly requests: string[] = [];
	readonly trees: { base_tree: string; tree: TreeEntry[] }[] = [];
	readonly commits: { message: string; tree: string; parents: string[] }[] = [];
	readonly refUpdates: { route: string; sha: string; force: boolean }[] = [];
	readonly comments: Comment[] = [];
	/** Files on the pull request's head, keyed by repository path. */
	readonly files = new Map<string, string>();
	/** Set to simulate someone pushing after the tests ran. */
	currentHead = FakeGitHub.HEAD_SHA;
	/** Makes creating a tree fail, like a token without `contents: write`. */
	refuseWrites = false;
	/** Makes reading comments fail, like a token with only `contents: write`. */
	refuseComments = false;

	readonly #server: http.Server;

	private constructor(server: http.Server) {
		this.#server = server;
	}

	static async start(): Promise<FakeGitHub> {
		const server = http.createServer();
		const github = new FakeGitHub(server);
		server.on("request", (request, response) => {
			void github.#handle(request, response);
		});
		await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
		return github;
	}

	get url(): string {
		return `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
	}

	close(): Promise<void> {
		return new Promise((done) => this.#server.close(() => done()));
	}

	async #handle(
		request: http.IncomingMessage,
		response: http.ServerResponse,
	): Promise<void> {
		let text = "";
		for await (const chunk of request) text += chunk;
		const body = text ? JSON.parse(text) : undefined;
		const method = request.method ?? "GET";
		const url = new URL(request.url ?? "/", this.url);
		const prefix = `/repos/${FakeGitHub.REPOSITORY}/`;
		const route = decodeURIComponent(url.pathname).slice(prefix.length);
		this.requests.push(`${method} ${route}`);

		const send = (status: number, value: unknown) => {
			response.statusCode = status;
			response.end(typeof value === "string" ? value : JSON.stringify(value));
		};

		if (request.headers.authorization !== "Bearer delivery-token") {
			return send(401, { message: "Bad credentials" });
		}

		if (method === "GET" && route === `git/ref/heads/${FakeGitHub.HEAD_REF}`) {
			return send(200, { object: { sha: this.currentHead } });
		}
		if (method === "GET" && route.startsWith("contents/")) {
			const file = this.files.get(route.slice("contents/".length));
			return file === undefined
				? send(404, { message: "Not Found" })
				: send(200, file);
		}
		if (method === "GET" && route.startsWith("git/commits/")) {
			return send(200, { tree: { sha: "base-tree" } });
		}
		if (method === "POST" && route === "git/trees") {
			if (this.refuseWrites) {
				return send(403, { message: "Resource not accessible by integration" });
			}
			this.trees.push(body);
			return send(201, { sha: "new-tree" });
		}
		if (method === "POST" && route === "git/commits") {
			this.commits.push(body);
			return send(201, { sha: "bbbbbbb2222" });
		}
		if (method === "PATCH" && route.startsWith("git/refs/heads/")) {
			this.refUpdates.push({ route, ...body });
			return send(200, {});
		}
		if (method === "GET" && route === `issues/${FakeGitHub.NUMBER}/comments`) {
			if (this.refuseComments) {
				return send(403, { message: "Resource not accessible by integration" });
			}
			return send(200, this.comments);
		}
		if (method === "POST" && route === `issues/${FakeGitHub.NUMBER}/comments`) {
			const comment = {
				id: this.comments.length + 1,
				body: body.body,
				user: { type: "Bot" },
			};
			this.comments.push(comment);
			return send(201, comment);
		}
		if (method === "PATCH" && route.startsWith("issues/comments/")) {
			const id = Number(route.slice("issues/comments/".length));
			const comment = this.comments.find((candidate) => candidate.id === id);
			if (!comment) return send(404, { message: "Not Found" });
			comment.body = body.body;
			return send(200, comment);
		}
		return send(404, { message: `No fake for ${method} ${route}` });
	}
}
