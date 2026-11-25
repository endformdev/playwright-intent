import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { WORKSPACES } from "../global-setup";
import type { AgentScript } from "../project/scripted-agent";

const PROJECT_TEMPLATE = path.resolve(import.meta.dirname, "..", "project");
const PLAYWRIGHT_CLI = createRequire(import.meta.url).resolve(
	"@playwright/test/cli",
);
/** The command a user runs, from the package as npm installs it. */
const INTENT_BIN = path.join(
	WORKSPACES,
	"node_modules",
	"playwright-intent",
	"dist",
	"bin.mjs",
);

/** What `npm init playwright-intent` runs, from this repository. */
const CREATE_BIN = path.resolve(
	import.meta.dirname,
	"../../../create-playwright-intent/index.mjs",
);

/**
 * Stands in for npm: it records each install and adds the packages to
 * package.json, as a real install would, without the network.
 */
const FAKE_NPM = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const root = process.env.FAKE_NPM_ROOT;
const where = path.relative(root, process.cwd());
const call = (where ? where + ": " : "") + "npm " + args.join(" ");
fs.appendFileSync(path.join(root, "npm-calls.log"), call + "\\n");
if (args[0] === "install") {
	const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
	manifest.devDependencies ??= {};
	for (const arg of args.slice(1).filter((arg) => !arg.startsWith("-"))) {
		const at = arg.lastIndexOf("@");
		const name = at > 0 ? arg.slice(0, at) : arg;
		manifest.devDependencies[name] = at > 0 ? arg.slice(at + 1) : "*";
	}
	fs.writeFileSync("package.json", JSON.stringify(manifest, null, 2) + "\\n");
}
`;

export interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

/**
 * A Playwright suite as a user has it before `playwright-intent init`, with
 * its own Git repository. `init` runs without a terminal, the way an agent or
 * a script runs it.
 */
export class SetupWorkspace {
	readonly directory: string;

	private constructor(directory: string) {
		this.directory = directory;
	}

	static async create(
		id: string,
		files: Record<string, string>,
	): Promise<SetupWorkspace> {
		const directory = path.join(WORKSPACES, id);
		const workspace = new SetupWorkspace(directory);
		await fs.mkdir(directory, { recursive: true });
		for (const [file, contents] of Object.entries(files)) {
			await workspace.write(file, contents);
		}
		spawnSync("git", ["init", "-q"], { cwd: directory });
		await fs.mkdir(workspace.#path(".fake-bin"), { recursive: true });
		await fs.writeFile(workspace.#path(".fake-bin", "npm"), FAKE_NPM, {
			mode: 0o755,
		});
		// Whatever type the suite's package has, the fake is CommonJS.
		await fs.writeFile(
			workspace.#path(".fake-bin", "package.json"),
			'{ "type": "commonjs" }',
		);
		return workspace;
	}

	/** Runs `playwright-intent` with these arguments. */
	async intent(...args: string[]): Promise<CommandResult> {
		return this.#runBin(INTENT_BIN, args);
	}

	/** Runs `create-playwright-intent`, as `npm init playwright-intent` does. */
	async createIntent(...args: string[]): Promise<CommandResult> {
		return this.#runBin(CREATE_BIN, args);
	}

	#runBin(bin: string, args: string[]): Promise<CommandResult> {
		return run(process.execPath, [bin, ...args], this.directory, {
			...cleanEnvironment(),
			PATH: `${this.#path(".fake-bin")}${path.delimiter}${process.env.PATH}`,
			FAKE_NPM_ROOT: this.directory,
		});
	}

	/** The commands the fake npm was given, after the folder if it isn't the root. */
	async npmCalls(): Promise<string[]> {
		const log = await this.read("npm-calls.log").catch(() => "");
		return log.split("\n").filter(Boolean);
	}

	/**
	 * Swaps the model `init` wrote for the scripted agent, so a run needs no
	 * model and every agent call is checked.
	 */
	async useScriptedAgent(script: AgentScript): Promise<void> {
		await fs.cp(
			path.join(PROJECT_TEMPLATE, "scripted-agent.ts"),
			this.#path("scripted-agent.ts"),
		);
		await fs.writeFile(this.#path("agent-script.json"), JSON.stringify(script));
		const config = await this.read("playwright.config.ts");
		const model = /model: (['"])openai\/gpt-6-luna\1,/;
		if (!model.test(config)) throw new Error(`No model to swap in:\n${config}`);
		await this.write(
			"playwright.config.ts",
			`import { createScriptedAgent } from "./scripted-agent";\n${config.replace(model, "agent: createScriptedAgent(),")}`,
		);
	}

	/** Adds the shop from the dogfood project, at http://shop.test. */
	async addShop(): Promise<void> {
		await fs.cp(path.join(PROJECT_TEMPLATE, "shop"), this.#path("shop"), {
			recursive: true,
		});
	}

	/** Runs `playwright test` with these arguments. */
	async playwright(...args: string[]): Promise<CommandResult> {
		return run(
			process.execPath,
			[PLAYWRIGHT_CLI, "test", ...args],
			this.directory,
			{
				...cleanEnvironment(),
				NO_COLOR: "1",
				PLAYWRIGHT_HTML_OPEN: "never",
				INTENT_E2E_AGENT_SCRIPT: this.#path("agent-script.json"),
			},
		);
	}

	/** Everything in `.intent`, relative to it and sorted. */
	async stepFiles(): Promise<string[]> {
		const directory = this.#path(".intent");
		const entries = await fs
			.readdir(directory, { recursive: true, withFileTypes: true })
			.catch(() => []);
		return entries
			.filter((entry) => entry.isFile())
			.map((entry) =>
				path.relative(directory, path.join(entry.parentPath, entry.name)),
			)
			.sort();
	}

	/** Every file the suite has, with its contents, to show nothing changed. */
	async snapshot(): Promise<Record<string, string>> {
		const entries = await fs.readdir(this.directory, {
			recursive: true,
			withFileTypes: true,
		});
		const files: Record<string, string> = {};
		for (const entry of entries) {
			const full = path.join(entry.parentPath, entry.name);
			const relative = path.relative(this.directory, full);
			if (!entry.isFile() || /^(\.git|\.fake-bin)\//.test(relative)) continue;
			files[relative] = await fs.readFile(full, "utf8");
		}
		return files;
	}

	async read(file: string): Promise<string> {
		return fs.readFile(this.#path(file), "utf8");
	}

	async write(file: string, contents: string): Promise<void> {
		await fs.mkdir(path.dirname(this.#path(file)), { recursive: true });
		await fs.writeFile(this.#path(file), contents);
	}

	async replaceInFile(file: string, from: string, to: string): Promise<void> {
		const contents = await this.read(file);
		if (!contents.includes(from))
			throw new Error(`"${from}" isn't in ${file}.`);
		await this.write(file, contents.replace(from, to));
	}

	async cleanUp(): Promise<void> {
		await fs.rm(this.directory, { recursive: true, force: true });
	}

	#path(...segments: string[]): string {
		return path.join(this.directory, ...segments);
	}
}

/** Nothing about the outer run, like a real key or CI, may leak in. */
function cleanEnvironment(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [name, value] of Object.entries(process.env)) {
		if (
			!/^(TEST_|PW_|GITHUB_|INTENT_|AI_GATEWAY_|npm_|CI$|FORCE_COLOR$|NO_COLOR$)/i.test(
				name,
			)
		) {
			env[name] = value;
		}
	}
	return env;
}

function run(
	program: string,
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv,
): Promise<CommandResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(program, args, { cwd, env });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", reject);
		child.on("close", (code) =>
			resolve({ exitCode: code ?? 1, stdout, stderr }),
		);
	});
}
