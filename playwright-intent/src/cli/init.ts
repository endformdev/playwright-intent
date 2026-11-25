import fs from "node:fs/promises";
import path from "node:path";
import { version } from "../../package.json";
import { configSnippet, DEFAULT_MODEL, editConfig } from "./config-edit";
import { checkIgnores, checkKey, KEY_NAME, KEY_URL, readKey } from "./env-file";
import { type FileChange, writeChange } from "./file-change";
import {
	atLeast,
	declares,
	findConfigs,
	installCommand,
	playwrightCommand,
	playwrightVersion,
	type Project,
	readProject,
	runCommand,
	vscodeTip,
} from "./project";
import { InitStop, type Prompts } from "./prompts";
import { isEsm, loadParser, type Parse } from "./source";
import { findPlaywrightImports, scanTestImports } from "./test-imports";

export interface InitOptions {
	cwd: string;
	/** The Playwright config to set up, when there's more than one. */
	config?: string;
	/** The AI Gateway model to write, when the config has no intent options. */
	model?: string;
	install: boolean;
	rewrite: boolean;
	dryRun: boolean;
	/** Null when there's no one to ask, like an agent or a script. */
	prompts: Prompts | null;
}

/**
 * Sets up playwright-intent in an existing Playwright project. Every answer is
 * gathered before anything is written, so stopping changes nothing. Running
 * it again only does what's still missing.
 */
export async function init(options: InitOptions): Promise<number> {
	const { cwd, prompts } = options;
	const relative = (file: string) => path.relative(cwd, file) || ".";

	const config = await chooseConfig(options);
	const project = await readProject(config);
	if (!project) {
		throw new InitStop(
			`There's no package.json above ${relative(config)}, so there's nowhere to install playwright-intent.`,
		);
	}

	const packages: string[] = [];
	const left: string[] = [];
	const notes: string[] = [];

	const playwright = await playwrightVersion(project.directory);
	if (!playwright) {
		throw new InitStop(
			`Can't find @playwright/test from ${relative(project.directory)}. Install the project's dependencies, then run this again.`,
		);
	}
	if (!atLeast(playwright, 1, 60)) {
		const upgrade = installCommand(project, ["@playwright/test@latest"]);
		const message = `playwright-intent needs Playwright 1.60 or later, and this project has ${playwright}.`;
		if (!prompts || !(await prompts.confirm(`${message} Upgrade it?`))) {
			throw new InitStop(
				`${message} Upgrade it with:\n\n  ${upgrade.join(" ")}\n\nthen run this again.`,
			);
		}
		packages.push("@playwright/test@latest");
		left.push(
			"Install the browsers for the new Playwright version with `npx playwright install`.",
		);
	}

	const parse = loadParser(project.directory);
	let model = options.model ?? DEFAULT_MODEL;
	const changes: FileChange[] = [];
	let gatewayModel: string | undefined = model;
	if (parse) {
		const edits = await editProject(options, project, parse);
		changes.push(...edits.changes);
		left.push(...edits.left);
		notes.push(...edits.notes);
		gatewayModel = edits.gatewayModel;
		model = edits.model;
	} else {
		const files = await findPlaywrightImports(project.packageDirectory, [
			config,
		]);
		left.push(
			`Playwright's parser couldn't be loaded, so ${relative(config)} is left for you. Add the intent options:\n\n${configSnippet(model)}`,
		);
		if (files.length > 0) {
			left.push(
				`Import test from "playwright-intent" instead of "@playwright/test" in:\n\n${files.map((file) => `  ${relative(file)}`).join("\n")}`,
			);
		}
	}

	const envFile = path.join(project.directory, ".env");
	const key = gatewayModel ? await readKey(project.directory) : undefined;
	let keyWorks = false;
	if (gatewayModel && key) {
		const problem = await checkKey(key, gatewayModel);
		if (problem) left.push(problem);
		else keyWorks = true;
	} else if (gatewayModel) {
		left.push(
			`Add ${KEY_NAME} to ${relative(envFile)}, or set it in your environment. Get a key at ${KEY_URL}.`,
		);
	}

	const ignores = await checkIgnores(project.directory);
	if (ignores.change) changes.push(ignores.change);
	if (ignores.intentIgnored) {
		left.push(
			"Git ignores .intent, where steps are saved. Remove that rule, so steps can be reviewed and committed with your tests.",
		);
	}

	const tip = await vscodeTip(project.directory);
	if (tip) notes.push(tip);

	if (!declares(project.manifest, "playwright-intent")) {
		packages.unshift(`playwright-intent@^${version}`);
	}
	const install =
		packages.length > 0 ? installCommand(project, packages) : null;

	if (options.dryRun) {
		printDryRun(changes, install, left, notes, cwd);
		return 0;
	}

	for (const change of changes) await writeChange(change);

	let installed = false;
	let installFailed = false;
	if (install && options.install) {
		print(`Installing with ${install.join(" ")}\n`);
		installed = await runCommand(install, project.packageDirectory);
		if (!installed) {
			installFailed = true;
			left.unshift(
				`Installing failed. Run it yourself:\n\n  ${install.join(" ")}`,
			);
		}
	} else if (install) {
		left.unshift(`Install the packages:\n\n  ${install.join(" ")}`);
	}

	printSummary({
		project,
		changes,
		needsInstall: install !== null,
		installed: installed ? packages : [],
		keyWorks: keyWorks ? gatewayModel : undefined,
		left,
		notes,
		cwd,
	});
	return installFailed ? 1 : 0;
}

interface ProjectEdits {
	changes: FileChange[];
	left: string[];
	notes: string[];
	model: string;
	gatewayModel?: string;
}

/** The config and import changes, which need Playwright's parser. */
async function editProject(
	options: InitOptions,
	project: Project,
	parse: Parse,
): Promise<ProjectEdits> {
	const { cwd, prompts } = options;
	const relative = (file: string) => path.relative(cwd, file) || ".";
	const { config } = project;
	const left: string[] = [];
	const notes: string[] = [];

	const code = await fs.readFile(config, "utf8");
	const esm = await isEsm(config);
	let model = options.model ?? DEFAULT_MODEL;
	const needsOptions = editConfig({
		code,
		file: config,
		parse,
		esm,
		model,
	}).added.includes("intent options");
	if (needsOptions && prompts && !options.model) {
		model = await prompts.text(
			"Which Vercel AI Gateway model should write steps?",
			DEFAULT_MODEL,
		);
	}
	const configEdit = editConfig({ code, file: config, parse, esm, model });
	left.push(...configEdit.manual);

	const imports = await scanTestImports(project.packageDirectory, parse, [
		config,
	]);
	if (imports.conflicts.length > 0) {
		const lines = imports.conflicts.map(
			(conflict) =>
				`  ${relative(conflict.file)}:${conflict.line}  ${conflict.name}`,
		);
		throw new InitStop(
			`These fixtures already use names that playwright-intent adds:\n\n${lines.join("\n")}\n\nRename them, then run this again. Nothing was changed.`,
		);
	}
	let rewrites = options.rewrite ? imports.rewrites : [];
	if (rewrites.length > 0 && prompts) {
		const files = rewrites.map((rewrite) => `  ${relative(rewrite.file)}`);
		const confirmed = await prompts.confirm(
			`Import test from playwright-intent instead of @playwright/test in:\n${files.join("\n")}\n`,
		);
		if (!confirmed) rewrites = [];
	}
	if (rewrites.length < imports.rewrites.length) {
		left.push(
			`Import test from "playwright-intent" instead of "@playwright/test" in the tests that call ai.do.`,
		);
	} else if (
		imports.rewrites.length === 0 &&
		imports.intentFiles.length === 0 &&
		imports.packages.length === 0
	) {
		left.push(
			`Import test from "playwright-intent" in the tests that call ai.do.`,
		);
	}
	for (const found of imports.packages) {
		const files = found.files.map((file) => `  ${relative(file)}`).join("\n");
		left.push(
			`These files take test from ${found.name}, which builds on @playwright/test:\n\n${files}\n\nSwitch ${found.name}'s own import of test to "playwright-intent", or extend it where you import it:\n\n  import { createIntentTest } from "playwright-intent";\n  export const test = createIntentTest(base);`,
		);
	}
	if (imports.unreadable.length > 0) {
		const files = imports.unreadable
			.map((file) => `  ${relative(file)}`)
			.join("\n");
		left.push(
			`These files couldn't be parsed, so check their imports of test by hand:\n\n${files}`,
		);
	}
	if (imports.componentTests.length > 0) {
		notes.push(
			"Component tests aren't set up, because ai.do only works in end-to-end tests.",
		);
	}

	const changes: FileChange[] = [];
	if (configEdit.code !== code) {
		changes.push({
			file: config,
			before: code,
			after: configEdit.code,
			summary: configEdit.added.join(", "),
		});
	}
	for (const rewrite of rewrites) {
		changes.push({
			file: rewrite.file,
			before: rewrite.before,
			after: rewrite.after,
			summary: "imports test from playwright-intent",
		});
	}
	return {
		changes,
		left,
		notes,
		model,
		gatewayModel: configEdit.gatewayModel,
	};
}

async function chooseConfig(options: InitOptions): Promise<string> {
	const { cwd, prompts } = options;
	if (options.config) {
		const config = path.resolve(cwd, options.config);
		const found = await fs.stat(config).catch(() => null);
		if (!found?.isFile())
			throw new InitStop(`There's no file at ${options.config}.`);
		return config;
	}

	const configs = await findConfigs(cwd);
	if (configs.length === 0) {
		throw new InitStop(
			"There's no playwright.config here. Set up Playwright first with `npm init playwright@latest`, then run this again.",
		);
	}
	const [only] = configs;
	if (only && configs.length === 1) return only;

	const relative = configs.map((config) => path.relative(cwd, config));
	if (prompts) {
		const chosen = await prompts.select(
			"Which Playwright config should use playwright-intent?",
			relative,
		);
		return path.resolve(cwd, chosen);
	}
	const commands = relative.map(
		(config) => `  npx playwright-intent init --config ${config}`,
	);
	throw new InitStop(
		`There are ${configs.length} Playwright configs here. Run this again for the one to set up:\n\n${commands.join("\n")}`,
	);
}

function print(text = ""): void {
	process.stdout.write(`${text}\n`);
}

function printDryRun(
	changes: FileChange[],
	install: string[] | null,
	left: string[],
	notes: string[],
	cwd: string,
): void {
	if (changes.length === 0 && !install) print("Nothing to change.");
	if (changes.length > 0) {
		print("Would change");
		printChanges(changes, cwd);
	}
	if (install) print(`\nWould install with ${install.join(" ")}`);
	for (const note of notes) print(`\n${note}`);
	printList("Left for you", left);
}

function printChanges(changes: FileChange[], cwd: string): void {
	const names = changes.map((change) => path.relative(cwd, change.file));
	const width = Math.max(...names.map((name) => name.length));
	changes.forEach((change, index) => {
		print(`  ${names[index]?.padEnd(width)}  ${change.summary}`);
	});
}

interface Summary {
	project: Project;
	changes: FileChange[];
	needsInstall: boolean;
	installed: string[];
	keyWorks?: string;
	left: string[];
	notes: string[];
	cwd: string;
}

function printSummary(summary: Summary): void {
	const { project, changes, cwd } = summary;
	const config = path.relative(cwd, project.config);

	if (changes.length === 0 && !summary.needsInstall) {
		print(
			`playwright-intent is already set up in ${config}. Nothing to change.`,
		);
	} else {
		print(`Set up playwright-intent in ${config}.`);
	}

	if (changes.length > 0) {
		print("\nChanged");
		printChanges(changes, cwd);
	}
	if (summary.installed.length > 0) {
		print(`\nInstalled ${summary.installed.join(", ")}.`);
	}
	if (summary.keyWorks) {
		print(`\n${KEY_NAME} works with ${summary.keyWorks}.`);
	}
	for (const note of summary.notes) print(`\n${note}`);
	printList("Left for you", summary.left);

	if (changes.length > 0) {
		print(
			`\nNext, write \`await ai.do("…")\` in a test, run \`${playwrightCommand(project)}\`, and commit the .intent folder with your tests.`,
		);
	}
}

function printList(heading: string, items: string[]): void {
	if (items.length === 0) return;
	print(`\n${heading}`);
	items.forEach((item, index) => {
		const [first, ...rest] = item.split("\n");
		print(`  ${index + 1}. ${first}`);
		for (const line of rest) print(line ? `     ${line}` : "");
	});
}
