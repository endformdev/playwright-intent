import { watch } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE = path.dirname(SOURCE);

const FONTS: Record<string, string> = {
	"jetbrains-mono": "@fontsource/jetbrains-mono/files",
	inter: "@fontsource/inter/files",
};

const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".ts": "text/javascript; charset=utf-8",
	".svg": "image/svg+xml",
	".woff2": "font/woff2",
	".json": "application/json",
};

export interface SceneServer {
	url: string;
	close(): Promise<void>;
}

/** Every scene module in `src/scenes`, by name. */
export async function sceneNames(): Promise<string[]> {
	const files = await readdir(path.join(SOURCE, "scenes"));
	return files
		.filter((file) => file.endsWith(".ts"))
		.map((file) => file.slice(0, -3))
		.sort();
}

/**
 * Serves `src` to the browser. TypeScript is served with its types stripped,
 * so scenes import each other with `.ts` paths, just like in Node.
 */
export async function startServer(
	options: { port?: number; live?: boolean } = {},
): Promise<SceneServer> {
	const listeners = new Set<ServerResponse>();

	const server = createServer(async (request, response) => {
		const url = new URL(request.url ?? "/", "http://localhost");
		try {
			if (url.pathname === "/") {
				response.writeHead(302, { location: "/player.html" });
				response.end();
				return;
			}
			if (url.pathname === "/scenes.json") {
				send(response, ".json", JSON.stringify(await sceneNames()));
				return;
			}
			if (url.pathname === "/events") {
				response.writeHead(200, {
					"content-type": "text/event-stream",
					"cache-control": "no-cache",
				});
				response.write(": connected\n\n");
				listeners.add(response);
				request.on("close", () => listeners.delete(response));
				return;
			}

			const file = resolveFile(url.pathname);
			const extension = path.extname(file);
			const contents = await readFile(file);
			if (extension === ".ts") {
				const code = stripTypeScriptTypes(contents.toString("utf8"), {
					mode: "strip",
				});
				send(response, extension, code);
			} else {
				send(response, extension, contents);
			}
		} catch {
			response.writeHead(404);
			response.end("Not found");
		}
	});

	const watcher = options.live
		? watch(SOURCE, { recursive: true }, () => {
				for (const listener of listeners) listener.write("data: change\n\n");
			})
		: null;

	await new Promise<void>((resolve) =>
		server.listen(options.port ?? 0, "127.0.0.1", resolve),
	);
	const { port } = server.address() as AddressInfo;

	return {
		url: `http://localhost:${port}`,
		async close() {
			watcher?.close();
			for (const listener of listeners) listener.end();
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
		},
	};
}

function resolveFile(pathname: string): string {
	const [, root, ...rest] = decodeURIComponent(pathname).split("/");
	if (root === "fonts") {
		const [font, file] = rest;
		const directory = FONTS[font ?? ""];
		if (!directory || !file) throw new Error("Unknown font");
		return path.join(PACKAGE, "node_modules", directory, path.basename(file));
	}

	const file = path.join(SOURCE, pathname);
	if (!file.startsWith(SOURCE + path.sep)) throw new Error("Outside source");
	return file;
}

function send(
	response: ServerResponse,
	extension: string,
	body: string | Buffer,
): void {
	response.writeHead(200, {
		"content-type": TYPES[extension] ?? "application/octet-stream",
		"cache-control": "no-store",
	});
	response.end(body);
}
