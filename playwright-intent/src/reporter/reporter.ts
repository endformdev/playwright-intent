import fs from "node:fs/promises";
import path from "node:path";
import type {
	FullConfig,
	Reporter,
	Suite,
	TestResult,
} from "@playwright/test/reporter";
import { IntentConfigError } from "../errors";
import {
	CONFIG_EXAMPLE,
	type IntentOptions,
	type IntentUseOptions,
} from "../options";
import { configDirectory, INTENT_DIRECTORY } from "../step/step-path";
import {
	CHANGE_ATTACHMENT,
	type ChangeRecord,
	PASSED_ATTACHMENT,
	parseChangeRecord,
} from "../store/change-record";
import type { IntentStoreProvider } from "../store/store";
import {
	type AttemptChanges,
	buildChangeSet,
	type ChangeSet,
	type RunChange,
} from "./change-set";

/**
 * Sees every test in a run, which a worker can't. Takes the same options as
 * `use.intent`, and delivers changes for stores that need it. Works under
 * `merge-reports` when it's given `-c`.
 */
export default class IntentReporter implements Reporter {
	#store?: IntentStoreProvider;
	#prepared?: Promise<void>;
	#directory = "";
	#sharded = false;
	#suite?: Suite;

	/**
	 * Playwright adds its own options, like `configDir`. The reporter is created
	 * before global setup and before workers start, so the store prepares here.
	 * That includes `merge-reports` and `--list`, which don't need it, so a
	 * failure is left for the workers to report.
	 */
	constructor(options: Partial<IntentOptions> & { configDir?: string } = {}) {
		const store = options.store;
		const { configDir } = options;
		this.#store = store;
		if (store?.prepare && configDir) {
			const root = path.join(configDir, INTENT_DIRECTORY);
			this.#prepared = Promise.resolve()
				.then(() => store.prepare?.({ root, env: process.env }))
				.catch(() => {});
		}
	}

	printsToStdio(): boolean {
		return false;
	}

	onBegin(config: FullConfig, suite: Suite): void {
		this.#directory = configDirectory(config);
		this.#sharded = Boolean(config.shard);
		this.#suite = suite;
		if (!this.#store) assertStoreNeedsNoOptions(config);
	}

	async onEnd(): Promise<void> {
		await this.#prepared;
		const tests = await Promise.all(
			(this.#suite?.allTests() ?? []).map(async (test) => ({
				title: test.titlePath().filter(Boolean).join(" > "),
				attempts: await Promise.all(test.results.map(readAttempt)),
			})),
		);
		const root = path.join(this.#directory, INTENT_DIRECTORY);
		const changes = buildChangeSet(tests);

		printChanges(changes);

		const deliver = this.#store?.deliver;
		if (!deliver) return;
		try {
			await deliver({
				changes,
				root,
				env: process.env,
				sharded: this.#sharded,
			});
		} catch (error) {
			// merge-reports only exits non-zero when a reporter throws, and it only
			// shows that error to other reporters, so this prints it as well.
			const message = `Couldn't deliver the step changes: ${error}`;
			console.error(`[intent] ${message}`);
			throw new Error(message);
		}
	}
}

/**
 * `use` is stripped under `merge-reports`, so this only catches a missing
 * option when the tests run.
 */
function assertStoreNeedsNoOptions(config: FullConfig): void {
	const needsReporter = config.projects.some((project) => {
		const store = (project.use as IntentUseOptions).intent?.store;
		return store?.prepare || store?.updates?.(process.env).delivered;
	});
	if (needsReporter) {
		throw new IntentConfigError(
			"The store works through playwright-intent/reporter, so pass the " +
				`reporter the same options as use.intent:\n\n${CONFIG_EXAMPLE}`,
		);
	}
}

async function readAttempt(result: TestResult): Promise<AttemptChanges> {
	const records: ChangeRecord[] = [];
	for (const attachment of result.attachments) {
		if (attachment.name !== CHANGE_ATTACHMENT) continue;
		const record = parseChangeRecord(await attachmentText(attachment));
		if (record) records.push(record);
		else console.log("[intent] Ignored a step change record it couldn't read.");
	}
	const failedByPropose = result.attachments.some(
		(attachment) => attachment.name === PASSED_ATTACHMENT,
	);
	return { passed: result.status === "passed" || failedByPropose, records };
}

async function attachmentText(
	attachment: TestResult["attachments"][number],
): Promise<string> {
	if (attachment.body) return attachment.body.toString("utf8");
	return attachment.path
		? fs.readFile(attachment.path, "utf8").catch(() => "")
		: "";
}

function printChanges({ passed, failed, diagnoses }: ChangeSet): void {
	const lines: string[] = [];
	if (passed.length > 0) {
		lines.push(`[intent] Step changes from passing tests (${passed.length}):`);
		lines.push(...passed.map(describeChange));
	}
	if (failed.length > 0) {
		lines.push(
			`[intent] Step changes from failing tests, left out (${failed.length}):`,
		);
		lines.push(...failed.map(describeChange));
	}
	if (diagnoses.length > 0) {
		lines.push(`[intent] Failures the agent left alone (${diagnoses.length}):`);
		lines.push(...diagnoses.map(({ test, reason }) => `  ${test}: ${reason}`));
	}
	if (lines.length > 0) console.log(lines.join("\n"));
}

function describeChange(change: RunChange): string {
	const details = [change.kind, change.cause].join(", ");
	const because = change.reason ? `: ${change.reason}` : "";
	return `  ${INTENT_DIRECTORY}/${change.key} (${details})${because}`;
}
