import { parseArgs } from "node:util";
import { version } from "../../package.json";
import { init } from "./init";
import { InitStop, terminalPrompts } from "./prompts";

const USAGE = `Usage: playwright-intent init [options]

Sets up playwright-intent in an existing Playwright project: installs it,
adds its options to playwright.config, and switches imports of test from
@playwright/test to playwright-intent. Running it again only does what's
still missing.

It only asks questions in a terminal. Without one, as when an agent or a
script runs it, it uses the defaults below and never waits for input.

Options:
  --config <path>  The Playwright config to set up, when there's more than one
  --model <id>     The Vercel AI Gateway model to use (default: openai/gpt-6-luna)
  --dry-run        List the changes, and write nothing
  --no-install     Don't install packages, and print the command instead
  --no-rewrite     Don't change imports in test files
  -y, --yes        Don't ask questions, even in a terminal
  -h, --help       Show this help
  -v, --version    Show the version
`;

/**
 * Runs the `playwright-intent` command with its arguments, and returns the
 * exit code. `create-playwright-intent` calls this with `init` first.
 */
export async function runCli(args: string[]): Promise<number> {
	const major = Number.parseInt(process.versions.node, 10);
	if (major < 24) {
		process.stderr.write(
			`playwright-intent needs Node 24 or later, and this is Node ${process.versions.node}.\n`,
		);
		return 1;
	}

	let parsed: ReturnType<typeof parse>;
	try {
		parsed = parse(args);
	} catch (error) {
		process.stderr.write(`${(error as Error).message}\n\n${USAGE}`);
		return 1;
	}
	const { values, positionals } = parsed;

	if (values.version) {
		process.stdout.write(`${version}\n`);
		return 0;
	}
	const [command, ...extra] = positionals;
	if (values.help || !command) {
		process.stdout.write(USAGE);
		return values.help ? 0 : 1;
	}
	if (command !== "init" || extra.length > 0) {
		process.stderr.write(
			`Unknown command: ${positionals.join(" ")}\n\n${USAGE}`,
		);
		return 1;
	}

	const interactive =
		!values.yes && Boolean(process.stdin.isTTY && process.stdout.isTTY);
	try {
		return await init({
			cwd: process.cwd(),
			config: values.config,
			model: values.model,
			install: !values["no-install"],
			rewrite: !values["no-rewrite"],
			dryRun: Boolean(values["dry-run"]),
			prompts: interactive ? terminalPrompts : null,
		});
	} catch (error) {
		if (error instanceof InitStop) {
			process.stderr.write(`${error.message}\n`);
			return 1;
		}
		throw error;
	}
}

function parse(args: string[]) {
	return parseArgs({
		args,
		allowPositionals: true,
		strict: true,
		options: {
			config: { type: "string" },
			model: { type: "string" },
			"dry-run": { type: "boolean" },
			"no-install": { type: "boolean" },
			"no-rewrite": { type: "boolean" },
			yes: { type: "boolean", short: "y" },
			help: { type: "boolean", short: "h" },
			version: { type: "boolean", short: "v" },
		},
	});
}
