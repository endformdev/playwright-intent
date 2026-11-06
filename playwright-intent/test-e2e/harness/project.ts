import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { IntentMode } from "playwright-intent";
import { WORKSPACES } from "../global-setup";
import {
	AGENT_CALLS_FILE,
	type AgentCall,
	type AgentScript,
} from "../project/scripted-agent";
import {
	MODEL_CALLS_FILE,
	MODEL_SCRIPT_FILE,
	type ModelScript,
} from "../project/scripted-model";
import type { ShopVariant } from "../project/shop/app";
import { readTrace, type TraceContents } from "./trace";

const PROJECT_TEMPLATE = path.resolve(import.meta.dirname, "..", "project");
const PLAYWRIGHT_CLI = createRequire(import.meta.url).resolve(
	"@playwright/test/cli",
);

export interface RunOptions {
	/** Sets `PW_INTENT`. Leave out to rely on the config or the defaults. */
	mode?: IntentMode;
	/** Sets `use.intent.mode` in the project's config. */
	configMode?: IntentMode;
	retries?: number;
	shop?: ShopVariant;
	/** Runs as if on CI, which picks the project's `onChange.ci`. */
	ci?: boolean;
	/** Uses `onChange: keep()` for every run, instead of a local and CI pair. */
	keepEverywhere?: boolean;
	/** Runs with a config that sets no `use.intent.store`. */
	withoutStore?: boolean;
	/** Runs without an agent, like a config that sets no model. */
	withoutAgent?: boolean;
	/** Test files to run. Defaults to the checkout test, which passes cleanly. */
	files?: string[];
	grep?: string;
	/** Text for `use.intent.context` to return. */
	failureContext?: string;
	/** Sets the test timeout, to reach timeouts quickly. */
	timeout?: number;
}

export interface TestResultSummary {
	/** Playwright's overall result: `flaky` means it passed on a retry. */
	outcome: "expected" | "unexpected" | "flaky" | "skipped";
	attempts: string[];
	/** The first line of each error, across all attempts. */
	errors: string[];
	/** The error snippets Playwright printed, across all attempts. */
	snippets: string[];
	/** The names of everything attached, across all attempts. */
	attachments: string[];
	/** What the library reported about failures, across all attempts. */
	notes: string[];
	trace(attempt?: number): TraceContents;
}

export interface RunResult {
	exitCode: number;
	output: string;
	test(title: string): TestResultSummary;
}

export interface ProjectOptions {
	id: string;
	moduleType?: "esm" | "cjs";
	/** Uses a store outside `.intent`, like R2 or the cache API would be. */
	remoteStore?: boolean;
}

/** A private copy of the dogfood project, driven by a flow. */
export class Project {
	readonly directory: string;
	readonly #remoteDirectory?: string;

	private constructor(directory: string, remoteDirectory?: string) {
		this.directory = directory;
		this.#remoteDirectory = remoteDirectory;
	}

	static async create(options: ProjectOptions): Promise<Project> {
		const directory = path.join(WORKSPACES, options.id);
		await fs.cp(PROJECT_TEMPLATE, directory, { recursive: true });
		await fs.writeFile(
			path.join(directory, "package.json"),
			JSON.stringify({
				name: "dogfood",
				private: true,
				...(options.moduleType === "cjs" ? {} : { type: "module" }),
			}),
		);
		return new Project(
			directory,
			options.remoteStore ? `${directory}-remote` : undefined,
		);
	}

	async scriptAgent(script: AgentScript): Promise<void> {
		await fs.writeFile(this.#path("agent-script.json"), JSON.stringify(script));
	}

	/** Uses the real built-in agent, on a model that follows this script. */
	async scriptModel(script: ModelScript): Promise<void> {
		await fs.writeFile(this.#path(MODEL_SCRIPT_FILE), JSON.stringify(script));
	}

	async run(options: RunOptions = {}): Promise<RunResult> {
		const args = [
			PLAYWRIGHT_CLI,
			"test",
			`--retries=${options.retries ?? 0}`,
			...(options.grep ? ["--grep", options.grep] : []),
			...(options.timeout ? [`--timeout=${options.timeout}`] : []),
			...(options.files ?? ["tests/checkout.spec.ts"]),
		];

		const { exitCode, output } = await spawnPlaywright(
			args,
			this.directory,
			this.#environment(options),
		);
		const report = await fs
			.readFile(this.#path("report.json"), "utf8")
			.catch(() => {
				throw new Error(`Playwright wrote no report:\n${output}`);
			});
		return createRunResult(exitCode, output, JSON.parse(report));
	}

	/** Everything in `.intent`, relative to it and sorted. */
	async stepFiles(): Promise<string[]> {
		return listFiles(this.#path(".intent"));
	}

	async readStep(key: string): Promise<string> {
		return fs.readFile(this.#path(".intent", key), "utf8");
	}

	async writeStep(key: string, source: string): Promise<void> {
		await fs.mkdir(path.dirname(this.#path(".intent", key)), {
			recursive: true,
		});
		await fs.writeFile(this.#path(".intent", key), source);
	}

	async remoteFiles(): Promise<string[]> {
		if (!this.#remoteDirectory) throw new Error("No remote store configured.");
		return listFiles(this.#remoteDirectory);
	}

	async clearLocalSteps(): Promise<void> {
		await fs.rm(this.#path(".intent"), { recursive: true, force: true });
	}

	/** The prompt of each model call, as JSON. */
	async modelCalls(): Promise<string[]> {
		const log = await fs
			.readFile(this.#path(MODEL_CALLS_FILE), "utf8")
			.catch(() => "");
		return log.split("\n").filter(Boolean);
	}

	async agentCalls(): Promise<AgentCall[]> {
		const log = await fs
			.readFile(this.#path(AGENT_CALLS_FILE), "utf8")
			.catch(() => "");
		return log
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as AgentCall);
	}

	async replaceInFile(file: string, from: string, to: string): Promise<void> {
		const contents = await fs.readFile(this.#path(file), "utf8");
		if (!contents.includes(from)) {
			throw new Error(`"${from}" isn't in ${file}.`);
		}
		await fs.writeFile(this.#path(file), contents.replace(from, to));
	}

	async cleanUp(): Promise<void> {
		await fs.rm(this.directory, { recursive: true, force: true });
		if (this.#remoteDirectory) {
			await fs.rm(this.#remoteDirectory, { recursive: true, force: true });
		}
	}

	#path(...segments: string[]): string {
		return path.join(this.directory, ...segments);
	}

	#environment(options: RunOptions): NodeJS.ProcessEnv {
		const env: NodeJS.ProcessEnv = {};
		// Nothing about the outer run may leak into the run being tested.
		for (const [name, value] of Object.entries(process.env)) {
			if (!/^(TEST_|PW_|CI$|FORCE_COLOR$|NO_COLOR$)/.test(name)) {
				env[name] = value;
			}
		}

		return {
			...env,
			NO_COLOR: "1",
			INTENT_E2E_AGENT_SCRIPT: this.#path("agent-script.json"),
			SHOP_VARIANT: options.shop ?? "baseline",
			...(options.mode && { PW_INTENT: options.mode }),
			...(options.configMode && {
				INTENT_E2E_CONFIG_MODE: options.configMode,
			}),
			...(options.ci && { CI: "true" }),
			...(options.keepEverywhere && { INTENT_E2E_ON_CHANGE: "keep" }),
			...(options.withoutStore && { INTENT_E2E_NO_STORE: "1" }),
			...(options.withoutAgent && { INTENT_E2E_NO_AGENT: "1" }),
			...(options.failureContext && {
				INTENT_E2E_FAILURE_CONTEXT: options.failureContext,
			}),
			...(this.#remoteDirectory && {
				INTENT_E2E_REMOTE_DIR: this.#remoteDirectory,
			}),
		};
	}
}

function spawnPlaywright(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv,
): Promise<{ exitCode: number; output: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, args, { cwd, env });
		let output = "";
		child.stdout.on("data", (chunk) => (output += chunk));
		child.stderr.on("data", (chunk) => (output += chunk));
		child.on("error", reject);
		child.on("close", (code) => resolve({ exitCode: code ?? 1, output }));
	});
}

async function listFiles(directory: string): Promise<string[]> {
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

interface JsonSuite {
	specs?: JsonSpec[];
	suites?: JsonSuite[];
}

interface JsonSpec {
	title: string;
	tests: {
		status: TestResultSummary["outcome"];
		results: {
			status: string;
			errors: { message?: string }[];
			error?: { snippet?: string };
			attachments: { name: string; path?: string }[];
			annotations?: { type: string; description?: string }[];
		}[];
	}[];
}

function createRunResult(
	exitCode: number,
	output: string,
	report: { suites: JsonSuite[] },
): RunResult {
	const specs = report.suites.flatMap(collectSpecs);

	return {
		exitCode,
		output,
		test(title) {
			const test = specs.find((spec) => spec.title === title)?.tests[0];
			if (!test) {
				const known = specs.map((spec) => spec.title).join(", ");
				throw new Error(`No test "${title}". Ran: ${known || "nothing"}.`);
			}
			return {
				outcome: test.status,
				attempts: test.results.map((result) => result.status),
				errors: test.results.flatMap((result) =>
					result.errors.map((error) => firstLine(error.message)),
				),
				snippets: test.results.flatMap((result) => result.error?.snippet ?? []),
				attachments: test.results.flatMap((result) =>
					result.attachments.map((attachment) => attachment.name),
				),
				notes: test.results.flatMap((result) =>
					(result.annotations ?? []).flatMap((annotation) =>
						annotation.type === "intent" && annotation.description
							? [annotation.description]
							: [],
					),
				),
				trace(attempt = 0) {
					const trace = test.results[attempt]?.attachments.find(
						(attachment) => attachment.name === "trace",
					);
					if (!trace?.path) throw new Error(`No trace for "${title}".`);
					return readTrace(trace.path);
				},
			};
		},
	};
}

function collectSpecs(suite: JsonSuite): JsonSpec[] {
	return [
		...(suite.specs ?? []),
		...(suite.suites ?? []).flatMap(collectSpecs),
	];
}

function firstLine(message = ""): string {
	return message.split("\n")[0] ?? "";
}
