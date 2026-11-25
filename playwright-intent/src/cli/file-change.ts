import fs from "node:fs/promises";
import path from "node:path";

export interface FileChange {
	file: string;
	/** Null for a new file. */
	before: string | null;
	after: string;
	/** What changed, like "ignores .env". */
	summary: string;
}

export async function writeChange(change: FileChange): Promise<void> {
	await fs.mkdir(path.dirname(change.file), { recursive: true });
	await fs.writeFile(change.file, change.after);
}
