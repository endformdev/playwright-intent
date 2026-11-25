import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import type { FileChange } from "./file-change";

export const KEY_NAME = "AI_GATEWAY_API_KEY";
export const KEY_URL = "https://vercel.com/ai-gateway";

/** The AI Gateway key from the environment, or from `.env` beside the config. */
export async function readKey(directory: string): Promise<string | undefined> {
	if (process.env[KEY_NAME]) return process.env[KEY_NAME];
	const env = await fs
		.readFile(path.join(directory, ".env"), "utf8")
		.catch(() => "");
	return parseEnv(env)[KEY_NAME] || undefined;
}

export interface IgnoreCheck {
	/** Adds `.env` to `.gitignore`, when Git wouldn't ignore it yet. */
	change?: FileChange;
	/** Whether Git ignores `.intent`, where steps are saved. */
	intentIgnored: boolean;
}

export async function checkIgnores(directory: string): Promise<IgnoreCheck> {
	const file = path.join(directory, ".gitignore");
	const before = await fs.readFile(file, "utf8").catch(() => null);
	const envIgnored = gitIgnores(directory, ".env");
	const intentIgnored = gitIgnores(directory, ".intent/step.ts") === true;
	const needsEntry =
		envIgnored === false ||
		(envIgnored === undefined &&
			before !== null &&
			!/^\/?(?:\*\*\/)?\.env\*?$/m.test(before));
	if (!needsEntry) return { intentIgnored };
	return {
		intentIgnored,
		change: {
			file,
			before,
			after: before ? `${before.trimEnd()}\n.env\n` : ".env\n",
			summary: "ignores .env",
		},
	};
}

/** Whether Git ignores the path, or undefined outside a repository. */
function gitIgnores(directory: string, file: string): boolean | undefined {
	const result = spawnSync("git", ["check-ignore", "-q", file], {
		cwd: directory,
	});
	if (result.status === 0) return true;
	if (result.status === 1) return false;
	return undefined;
}

/**
 * Checks the key, and that the model exists, without generating anything.
 * Returns what's wrong, if anything.
 */
export async function checkKey(
	key: string,
	model: string,
): Promise<string | undefined> {
	const { createGateway } = await import("ai");
	const gateway = createGateway({ apiKey: key });
	try {
		await withTimeout(gateway.getCredits(), 15_000);
	} catch (error) {
		return `Vercel AI Gateway didn't accept ${KEY_NAME}: ${errorMessage(error)}. Check the key at ${KEY_URL}.`;
	}
	try {
		const { models } = await withTimeout(gateway.getAvailableModels(), 15_000);
		if (!models.some((available) => available.id === model)) {
			return `Vercel AI Gateway has no model called ${model}. Pick one from ${KEY_URL}/models, and set it as model in the config.`;
		}
	} catch {
		// The key works, which is what matters. The model shows up on first use.
	}
	return undefined;
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error("timed out")), milliseconds).unref(),
		),
	]);
}

function errorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.split("\n")[0]?.replace(/\.$/, "") ?? message;
}
