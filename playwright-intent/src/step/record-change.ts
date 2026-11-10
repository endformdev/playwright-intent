import fs from "node:fs/promises";
import path from "node:path";
import { IntentChangeProposedError } from "../errors";
import type { TestScope } from "../fixture/test-scope";
import {
	CHANGE_ATTACHMENT,
	type ChangeDetails,
	type ChangeRecord,
	PASSED_ATTACHMENT,
} from "../store/change-record";

const CHANGED = "changed";
const PASSED = "passed";

/** Tells the reporter what this attempt changed, when its store delivers. */
export async function recordChange(
	scope: TestScope,
	details: ChangeDetails,
): Promise<void> {
	const { updates, testInfo } = scope;
	if (!updates.delivered) return;

	const record: ChangeRecord = { version: 2, ...details };
	await testInfo.attach(CHANGE_ATTACHMENT, {
		contentType: "application/json",
		body: JSON.stringify(record),
	});

	if (updates.awaitsReview && details.kind !== "diagnosis") {
		const marker = proposalMarker(scope);
		await fs.mkdir(path.dirname(marker), { recursive: true });
		await fs.writeFile(marker, CHANGED);
	}
}

/**
 * Drops what a previous run left, so only this run's attempts can count. Once
 * the test has passed with its changes, the retries left have nothing to add.
 */
export async function startProposalTracking(scope: TestScope): Promise<void> {
	if (!scope.updates.awaitsReview) return;
	const marker = proposalMarker(scope);
	if (scope.testInfo.retry === 0) {
		await fs.rm(marker, { force: true });
		return;
	}
	const state = await fs.readFile(marker, "utf8").catch(() => null);
	if (state === PASSED) throw proposedError();
}

/**
 * A pass with a saved change would exit 0, so this fails it from teardown. A
 * retry that passes with no change saved is a normal flaky test, and is left
 * alone.
 */
export async function failPassedProposal(scope: TestScope): Promise<void> {
	const { updates, testInfo } = scope;
	if (!updates.awaitsReview || testInfo.status !== "passed") return;

	const marker = proposalMarker(scope);
	const state = await fs.readFile(marker, "utf8").catch(() => null);
	if (state === null) return;
	await fs.writeFile(marker, PASSED);

	await testInfo.attach(PASSED_ATTACHMENT, {
		contentType: "text/plain",
		body: "passed",
	});
	throw proposedError();
}

function proposedError(): IntentChangeProposedError {
	return new IntentChangeProposedError(
		"The test passed with its step changes. propose() keeps it failing " +
			"until someone applies them.",
	);
}

/**
 * A retry is a new process, so this is how it learns an earlier attempt saved
 * a change or passed. Playwright clears the project's output folder at the start of a
 * run, but only each test's own folder between attempts.
 */
function proposalMarker({ testInfo }: TestScope): string {
	return path.join(
		testInfo.project.outputDir,
		".playwright-intent",
		`${testInfo.testId}.proposed`,
	);
}
