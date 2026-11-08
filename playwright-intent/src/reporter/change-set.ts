import type { ChangeRecord, StepChangeCause } from "../store/change-record";
import type { ChangeDelivery } from "../store/changes";

export interface AttemptChanges {
	/** It passed, or passed and was failed on purpose by `propose()`. */
	passed: boolean;
	records: ChangeRecord[];
}

export interface TestChanges {
	/** The project, file, describes and test, joined with ` > `. */
	title: string;
	attempts: AttemptChanges[];
}

/** What a whole run did to one step file. */
export interface RunChange {
	key: string;
	kind: "write" | "delete";
	cause: StepChangeCause;
	reason?: string;
	/** The step file the attempt saved. Missing for a delete. */
	source?: string;
	delivery: ChangeDelivery;
	tests: string[];
}

/** The agent looked at a failure and left the steps alone. */
export interface RunDiagnosis {
	test: string;
	key?: string;
	reason: string;
	delivery: ChangeDelivery;
}

export interface ChangeSet {
	/** A later attempt of the same test passed without rewriting these. */
	proven: RunChange[];
	unproven: RunChange[];
	diagnoses: RunDiagnosis[];
}

type FileRecord = Extract<ChangeRecord, { kind: "write" | "delete" }>;

function isFileRecord(record: ChangeRecord): record is FileRecord {
	return record.kind !== "diagnosis";
}

export function buildChangeSet(tests: TestChanges[]): ChangeSet {
	const proven = new Map<string, RunChange>();
	const unproven = new Map<string, RunChange>();
	const diagnoses = new Map<string, RunDiagnosis>();

	for (const { title, attempts } of tests) {
		const proofAt = attempts.findLastIndex(
			(attempt) => attempt.passed && !attempt.records.some(isFileRecord),
		);
		addChanges(proven, title, attempts.slice(0, Math.max(proofAt, 0)));
		addChanges(unproven, title, attempts.slice(proofAt + 1));

		for (const record of attempts.flatMap((attempt) => attempt.records)) {
			if (record.kind !== "diagnosis") continue;
			const { key, reason, delivery } = record;
			// Each attempt words its diagnosis differently, so keep the latest.
			diagnoses.set(`${title}\n${key}`, {
				test: title,
				...(key !== undefined && { key }),
				reason,
				delivery,
			});
		}
	}

	return {
		// Browser projects share steps, so a file proven in one test can still
		// have been overwritten by another test that went on to fail.
		proven: sortedByKey(proven).filter(({ key }) => !unproven.has(key)),
		unproven: sortedByKey(unproven),
		diagnoses: [...diagnoses.values()],
	};
}

function addChanges(
	changes: Map<string, RunChange>,
	title: string,
	attempts: AttemptChanges[],
): void {
	for (const change of netChanges(attempts)) {
		const tests = changes.get(change.key)?.tests ?? [];
		changes.set(change.key, { ...change, tests: [...tests, title] });
	}
}

/** One entry per file, for what its last record left behind. */
function netChanges(attempts: AttemptChanges[]): Omit<RunChange, "tests">[] {
	const net = new Map<string, Omit<RunChange, "tests">>();
	for (const record of attempts.flatMap((attempt) => attempt.records)) {
		if (!isFileRecord(record)) continue;
		const { key, kind, cause, reason, delivery } = record;
		const earlier = net.get(key);
		// `regenerate` deletes a step and a later attempt generates it again.
		const explained = reason ?? earlier?.reason;
		net.set(key, {
			key,
			kind,
			cause: earlier?.cause === "regenerate" ? "regenerate" : cause,
			...(explained !== undefined && { reason: explained }),
			...(record.kind === "write" && { source: record.source }),
			delivery,
		});
	}
	return [...net.values()];
}

function sortedByKey(changes: Map<string, RunChange>): RunChange[] {
	return [...changes.values()].sort((a, b) => a.key.localeCompare(b.key));
}
