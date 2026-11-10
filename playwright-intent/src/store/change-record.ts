import path from "node:path";

/** What each saved change is attached to its test as. */
export const CHANGE_ATTACHMENT = "intent-change";

/** Attached when a `propose()` attempt passed and the library failed it. */
export const PASSED_ATTACHMENT = "intent-passed";

export type StepChangeCause = "repair" | "generate" | "regenerate";

/** Everything but `version`, which the worker fills in. */
export type ChangeDetails =
	| {
			kind: "write";
			key: string;
			cause: StepChangeCause;
			reason?: string;
			/** The saved step file, so the report alone can deliver it. */
			source: string;
	  }
	| {
			kind: "delete";
			key: string;
			cause: StepChangeCause;
			reason?: string;
	  }
	/** The agent looked at a failure and left the steps alone. */
	| { kind: "diagnosis"; key?: string; reason: string };

/** What a test attaches for each change, when its store delivers them. */
export type ChangeRecord = ChangeDetails & { version: 1 };

/** Returns null for anything this version of the library can't act on. */
export function parseChangeRecord(text: string): ChangeRecord | null {
	let value: Record<string, unknown>;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}
	if (
		value?.version !== 1 ||
		(value.reason !== undefined && typeof value.reason !== "string")
	) {
		return null;
	}

	if (value.kind === "diagnosis") {
		const validKey = value.key === undefined || isStepKey(value.key);
		const valid = validKey && typeof value.reason === "string";
		return valid ? (value as unknown as ChangeRecord) : null;
	}
	const validCause = ["repair", "generate", "regenerate"].includes(
		value.cause as string,
	);
	const validKind =
		value.kind === "delete" ||
		(value.kind === "write" && typeof value.source === "string");
	return validKind && validCause && isStepKey(value.key)
		? (value as unknown as ChangeRecord)
		: null;
}

/** Only true for a relative path that stays inside `.intent`. */
function isStepKey(key: unknown): boolean {
	if (typeof key !== "string" || key === "" || key.includes("\\")) return false;
	if (path.posix.isAbsolute(key) || path.win32.isAbsolute(key)) return false;
	return key
		.split("/")
		.every((segment) => segment && segment !== "." && segment !== "..");
}
