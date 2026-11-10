import fs from "node:fs/promises";
import path from "node:path";
import type { CacheApiStorage } from "./storage";

/**
 * Keeps zips in a local folder. For tests, and for running the API on one
 * Node server.
 */
export function createFileSystemStorage(directory: string): CacheApiStorage {
	const resolve = (key: string) => {
		const file = path.resolve(directory, ...key.split("/"));
		if (!file.startsWith(path.resolve(directory) + path.sep)) {
			throw new Error(`${key} is outside the storage folder.`);
		}
		return file;
	};

	return {
		async put(key, data) {
			const file = resolve(key);
			await fs.mkdir(path.dirname(file), { recursive: true });
			const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
			await fs.writeFile(temp, new Uint8Array(data));
			await fs.rename(temp, file);
		},

		async get(key) {
			const data = await fs.readFile(resolve(key)).catch(ignoreMissing);
			if (data === null) return null;
			return data.buffer.slice(
				data.byteOffset,
				data.byteOffset + data.byteLength,
			) as ArrayBuffer;
		},

		async head(key) {
			return (await fs.stat(resolve(key)).catch(ignoreMissing)) !== null;
		},

		async list(prefix) {
			const entries = await fs
				.readdir(directory, { recursive: true, withFileTypes: true })
				.catch(ignoreMissing);
			return (entries ?? [])
				.filter((entry) => entry.isFile() && !entry.name.endsWith(".tmp"))
				.map((entry) =>
					path
						.relative(directory, path.join(entry.parentPath, entry.name))
						.split(path.sep)
						.join("/"),
				)
				.filter((key) => key.startsWith(prefix))
				.sort();
		},
	};
}

function ignoreMissing(error: NodeJS.ErrnoException): null {
	if (error.code === "ENOENT") return null;
	throw error;
}
