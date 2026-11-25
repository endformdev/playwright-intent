import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { walkFiles } from "./source";

const CONFIG_FILE = /^playwright\.config\.[cm]?[jt]s$/;

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface Manifest {
	name?: string;
	type?: string;
	packageManager?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
}

export interface Project {
	config: string;
	/** The folder the config is in, which holds `.intent` and `.env`. */
	directory: string;
	/** The folder of the package.json that dependencies go in. */
	packageDirectory: string;
	manifest: Manifest;
	packageManager: PackageManager;
	/** Whether the package is a pnpm workspace root, which needs `-w`. */
	workspaceRoot: boolean;
}

export async function findConfigs(root: string): Promise<string[]> {
	return walkFiles(root, (file) => CONFIG_FILE.test(path.basename(file)));
}

export async function readProject(config: string): Promise<Project | null> {
	const directory = path.dirname(config);
	let packageDirectory = directory;
	while (!(await exists(path.join(packageDirectory, "package.json")))) {
		const parent = path.dirname(packageDirectory);
		if (parent === packageDirectory) return null;
		packageDirectory = parent;
	}
	const manifest = JSON.parse(
		await fs.readFile(path.join(packageDirectory, "package.json"), "utf8"),
	) as Manifest;
	return {
		config,
		directory,
		packageDirectory,
		manifest,
		packageManager: await detectPackageManager(packageDirectory),
		workspaceRoot: await exists(
			path.join(packageDirectory, "pnpm-workspace.yaml"),
		),
	};
}

/** The installed `@playwright/test` version, as the config would load it. */
export async function playwrightVersion(
	directory: string,
): Promise<string | undefined> {
	try {
		const manifest = createRequire(path.join(directory, "noop.js")).resolve(
			"@playwright/test/package.json",
		);
		const { version } = JSON.parse(await fs.readFile(manifest, "utf8")) as {
			version: string;
		};
		return version;
	} catch {
		return undefined;
	}
}

export function atLeast(version: string, major: number, minor: number) {
	const [actualMajor = 0, actualMinor = 0] = version
		.split(".")
		.map((part) => Number.parseInt(part, 10));
	return actualMajor > major || (actualMajor === major && actualMinor >= minor);
}

export function declares(manifest: Manifest, name: string): boolean {
	return Boolean(
		manifest.dependencies?.[name] ?? manifest.devDependencies?.[name],
	);
}

const LOCKFILES: [string, PackageManager][] = [
	["pnpm-lock.yaml", "pnpm"],
	["yarn.lock", "yarn"],
	["bun.lock", "bun"],
	["bun.lockb", "bun"],
	["package-lock.json", "npm"],
];

async function detectPackageManager(start: string): Promise<PackageManager> {
	let directory = start;
	while (true) {
		for (const [file, manager] of LOCKFILES) {
			if (await exists(path.join(directory, file))) return manager;
		}
		const manifest = await fs
			.readFile(path.join(directory, "package.json"), "utf8")
			.then((text) => JSON.parse(text) as Manifest)
			.catch(() => null);
		const declared = manifest?.packageManager?.split("@")[0];
		if (isPackageManager(declared)) return declared;
		// A project's lockfile is never above its repository.
		if (await exists(path.join(directory, ".git"))) break;
		const parent = path.dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	const agent = process.env.npm_config_user_agent?.split("/")[0];
	return isPackageManager(agent) ? agent : "npm";
}

function isPackageManager(name: string | undefined): name is PackageManager {
	return name === "npm" || name === "pnpm" || name === "yarn" || name === "bun";
}

export function installCommand(project: Project, packages: string[]): string[] {
	switch (project.packageManager) {
		case "pnpm":
			return [
				"pnpm",
				"add",
				"--save-dev",
				...(project.workspaceRoot ? ["--workspace-root"] : []),
				...packages,
			];
		case "yarn":
			return ["yarn", "add", "--dev", ...packages];
		case "bun":
			return ["bun", "add", "--dev", ...packages];
		default:
			return ["npm", "install", "--save-dev", ...packages];
	}
}

/** How to run Playwright with the project's package manager. */
export function playwrightCommand(project: Project): string {
	switch (project.packageManager) {
		case "pnpm":
			return "pnpm exec playwright test";
		case "yarn":
			return "yarn playwright test";
		case "bun":
			return "bunx playwright test";
		default:
			return "npx playwright test";
	}
}

export function runCommand(command: string[], cwd: string): Promise<boolean> {
	const [program = "", ...args] = command;
	return new Promise((resolve) => {
		const child = spawn(program, args, {
			cwd,
			stdio: "inherit",
			shell: process.platform === "win32",
		});
		child.on("error", () => resolve(false));
		child.on("close", (code) => resolve(code === 0));
	});
}

export async function exists(file: string): Promise<boolean> {
	return fs
		.stat(file)
		.then(() => true)
		.catch(() => false);
}

const EXTENSION_ID = "endform.playwright-intent-vscode";

/**
 * A tip to recommend the VS Code extension, when the repository shares VS
 * Code settings and doesn't recommend it yet.
 */
export async function vscodeTip(start: string): Promise<string | undefined> {
	let directory = start;
	while (true) {
		const folder = path.join(directory, ".vscode");
		if (await exists(folder)) {
			const recommendations = await fs
				.readFile(path.join(folder, "extensions.json"), "utf8")
				.catch(() => "");
			if (recommendations.includes(EXTENSION_ID)) return undefined;
			return `To suggest the VS Code extension to your team, add "${EXTENSION_ID}" to the recommendations in ${path.join(path.relative(process.cwd(), folder) || ".vscode", "extensions.json")}.`;
		}
		if (await exists(path.join(directory, ".git"))) return undefined;
		const parent = path.dirname(directory);
		if (parent === directory) return undefined;
		directory = parent;
	}
}
