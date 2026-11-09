import fs from "node:fs/promises";
import path from "node:path";
import type {
	FullConfig,
	Reporter,
	Suite,
	TestResult,
} from "@playwright/test/reporter";
import { deliverChanges } from "../github/deliver";
import { configDirectory, INTENT_DIRECTORY } from "../step/step-path";
import {
	CHANGE_ATTACHMENT,
	type ChangeRecord,
	PASSED_ATTACHMENT,
	parseChangeRecord,
} from "../store/change-record";
import {
	type AttemptChanges,
	buildChangeSet,
	type ChangeSet,
	type RunChange,
} from "./change-set";

/**
 * Sees every test in a run, which a worker can't. Needed with `commit()` or
 * `propose()`, and works under `merge-reports` when it's given `-c`.
 */
export default class IntentReporter implements Reporter {
	#directory = "";
	#sharded = false;
	#suite?: Suite;

	printsToStdio(): boolean {
		return false;
	}

	onBegin(config: FullConfig, suite: Suite): void {
		this.#directory = configDirectory(config);
		this.#sharded = Boolean(config.shard);
		this.#suite = suite;
	}

	async onEnd(): Promise<void> {
		const tests = await Promise.all(
			(this.#suite?.allTests() ?? []).map(async (test) => ({
				title: test.titlePath().filter(Boolean).join(" > "),
				attempts: await Promise.all(test.results.map(readAttempt)),
			})),
		);
		const root = path.join(this.#directory, INTENT_DIRECTORY);
		const changes = buildChangeSet(tests);

		printChanges(changes);

		try {
			await deliverChanges({
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
	const details = [change.kind, change.cause, change.delivery].join(", ");
	const because = change.reason ? `: ${change.reason}` : "";
	return `  ${INTENT_DIRECTORY}/${change.key} (${details})${because}`;
}
