import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface PatchFile {
	path: string;
	before: string | null;
	after: string | null;
}

/**
 * A `git diff` from the repository root, built in a throwaway repository so it
 * doesn't depend on what's checked out: a `pull_request` run has a merge commit.
 */
export async function buildPatch(files: PatchFile[]): Promise<string> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "intent-patch-"));
	const git = (...args: string[]) =>
		run(
			"git",
			["-c", "core.quotepath=false", "-c", "core.autocrlf=false", ...args],
			{
				cwd: directory,
				// Nothing in here needs the delivery token.
				env: { PATH: process.env.PATH },
				maxBuffer: 64 * 1024 * 1024,
			},
		);
	const place = async (file: string, contents: string | null) => {
		const target = path.join(directory, ...file.split("/"));
		await fs.rm(target, { force: true });
		if (contents === null) return;
		await fs.mkdir(path.dirname(target), { recursive: true });
		await fs.writeFile(target, contents);
	};

	try {
		await git("init", "--quiet", "--template=");
		for (const file of files) await place(file.path, file.before);
		await git("add", "--all");
		await git(
			"-c",
			"user.name=intent",
			"-c",
			"user.email=intent@localhost",
			"commit",
			"--quiet",
			"--allow-empty",
			"--no-verify",
			"--message=before",
		);
		for (const file of files) await place(file.path, file.after);
		await git("add", "--all");
		const { stdout } = await git("diff", "--cached", "--no-color");
		return stdout;
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
}
