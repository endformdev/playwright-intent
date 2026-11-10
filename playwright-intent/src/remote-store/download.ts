import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IntentConfigError, IntentStoreError } from "../errors";
import { CONFIG_EXAMPLE } from "../options";
import { writeFileAtomic } from "../store/local-files";
import type { CacheClient } from "./cache-client";
import { readStepZip, testFolder } from "./step-zip";

/**
 * Points workers at the file the reporter writes once `.intent` is filled.
 * Workers are forked from the runner with its environment, so they see it.
 */
export const DOWNLOAD_STATUS_VARIABLE = "PLAYWRIGHT_INTENT_DOWNLOAD_STATUS";

const POLL_MS = 25;

type DownloadStatus = { ok: true } | { ok: false; message: string };

/**
 * Fills `.intent` from the stored zip, and tells workers when it's done. A
 * test folder that's already on disk is left as it is, so local work wins.
 */
export async function downloadSteps(
	client: CacheClient,
	root: string,
	env: NodeJS.ProcessEnv,
): Promise<void> {
	const directory = fs.mkdtempSync(
		path.join(os.tmpdir(), "playwright-intent-"),
	);
	const statusFile = path.join(directory, "download.json");
	env[DOWNLOAD_STATUS_VARIABLE] = statusFile;
	// Runs once every worker is gone, after the reporter's last hook.
	process.once("exit", () =>
		fs.rmSync(directory, { recursive: true, force: true }),
	);

	let status: DownloadStatus;
	try {
		const zip = await client.getMain();
		if (zip) await unpackSteps(zip, root);
		status = { ok: true };
	} catch (error) {
		status = { ok: false, message: (error as Error).message };
	}
	await writeFileAtomic(statusFile, JSON.stringify(status));
}

async function unpackSteps(zip: Uint8Array, root: string): Promise<void> {
	const folders = new Map<string, [string, string][]>();
	for (const [key, source] of readStepZip(zip)) {
		const folder = testFolder(key);
		folders.set(folder, [...(folders.get(folder) ?? []), [key, source]]);
	}
	for (const [folder, files] of folders) {
		const local = path.join(root, ...folder.split("/"));
		if (fs.existsSync(local)) continue;
		for (const [key, source] of files) {
			await writeFileAtomic(path.join(root, ...key.split("/")), source);
		}
	}
}

const waiting = new Map<string, Promise<void>>();

/** Resolves once the reporter has filled `.intent`, in a worker. */
export function waitForDownload(env: NodeJS.ProcessEnv): Promise<void> {
	const statusFile = env[DOWNLOAD_STATUS_VARIABLE];
	if (!statusFile) {
		return Promise.reject(
			new IntentConfigError(
				"remoteStore downloads steps from playwright-intent/reporter, so add " +
					`the reporter and pass it the same options as use.intent:\n\n${CONFIG_EXAMPLE}`,
			),
		);
	}
	let wait = waiting.get(statusFile);
	if (!wait) {
		wait = readStatus(statusFile);
		waiting.set(statusFile, wait);
	}
	return wait;
}

async function readStatus(statusFile: string): Promise<void> {
	for (;;) {
		const text = await fsp.readFile(statusFile, "utf8").catch(() => null);
		if (text !== null) {
			const status = JSON.parse(text) as DownloadStatus;
			if (status.ok) return;
			throw new IntentStoreError(status.message);
		}
		await new Promise((done) => setTimeout(done, POLL_MS));
	}
}
