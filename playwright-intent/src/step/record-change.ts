import fs from "node:fs/promises";
import path from "node:path";
import { IntentChangeProposedError } from "../errors";
import type { TestScope } from "../fixture/test-scope";
import {
	CHANGE_ATTACHMENT,
	type ChangeDetails,
	type ChangeRecord,
	PROOF_ATTACHMENT,
} from "../store/change-record";
import type { ChangeDelivery } from "../store/changes";

const CHANGED = "changed";
const PROVEN = "proven";

export function provedOnRetry(delivery: ChangeDelivery): string {
	return `${delivery}() proves a change by replaying it on a retry, so this attempt stops here.`;
}

/** Tells the reporter what this attempt changed. Does nothing for other policies. */
export async function recordChange(
	scope: TestScope,
	details: ChangeDetails,
): Promise<void> {
	const { delivery, testInfo } = scope;
	if (!delivery) return;

	const record: ChangeRecord = { version: 1, ...details, delivery };
	await testInfo.attach(CHANGE_ATTACHMENT, {
		contentType: "application/json",
		body: JSON.stringify(record),
	});

	if (delivery === "propose" && details.kind !== "diagnosis") {
		const marker = proposalMarker(scope);
		await fs.mkdir(path.dirname(marker), { recursive: true });
		await fs.writeFile(marker, CHANGED);
	}
}

/**
 * Drops what a previous run left, so only this run's attempts can count. Once
 * a retry has proved the change, the retries left have nothing to add.
 */
export async function startProposalTracking(scope: TestScope): Promise<void> {
	if (scope.delivery !== "propose") return;
	const marker = proposalMarker(scope);
	if (scope.testInfo.retry === 0) {
		await fs.rm(marker, { force: true });
		return;
	}
	const state = await fs.readFile(marker, "utf8").catch(() => null);
	if (state === PROVEN) throw proposedError();
}

/**
 * A pass after a saved change would be reported as flaky and exit 0, so this
 * fails it from teardown. A retry that passes with no earlier change is a
 * normal flaky test, and is left alone.
 */
export async function failProvenProposal(scope: TestScope): Promise<void> {
	const { delivery, testInfo } = scope;
	if (delivery !== "propose" || testInfo.status !== "passed") return;

	const marker = proposalMarker(scope);
	const state = await fs.readFile(marker, "utf8").catch(() => null);
	if (state === null) return;
	await fs.writeFile(marker, PROVEN);

	await testInfo.attach(PROOF_ATTACHMENT, {
		contentType: "text/plain",
		body: "passed",
	});
	throw proposedError();
}

function proposedError(): IntentChangeProposedError {
	return new IntentChangeProposedError(
		"A retry proved the step changes from an earlier attempt. propose() " +
			"keeps this test failing until someone applies them.",
	);
}

/**
 * A retry is a new process, so this is how it learns an earlier attempt saved
 * a change. Playwright clears the project's output folder at the start of a
 * run, but only each test's own folder between attempts.
 */
function proposalMarker({ testInfo }: TestScope): string {
	return path.join(
		testInfo.project.outputDir,
		".playwright-intent",
		`${testInfo.testId}.proposed`,
	);
}
