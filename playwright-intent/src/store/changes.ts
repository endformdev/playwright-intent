import { IntentChangeRejectedError } from "../errors";

/** Something the library is about to do that could change saved steps. */
export interface StepChange {
	/**
	 * - `generate`: a step needs new code.
	 * - `diagnose`: the agent may repair or regenerate steps after a failure.
	 * - `clear`: `all` mode is removing a test's steps.
	 */
	type: "generate" | "diagnose" | "clear";
	/** The test's describe and test titles, joined with ` > `. */
	test: string;
	/** Missing for `clear`, and for failures outside a step. */
	intent?: string;
}

/**
 * Runs in the worker before the agent starts. Throw to stop the change, and
 * the test fails without spending anything on the model.
 */
export type ChangeCheck = (change: StepChange) => void | Promise<void>;

/** A policy the library can identify. `custom` is a user's own function. */
export interface NamedChangePolicy {
	readonly name: "allow" | "refuse" | "custom";
	readonly check: ChangeCheck;
}

/**
 * A built-in policy, or your own function. A function can decide whether a
 * change is allowed, but it can't deliver the change anywhere.
 */
export type ChangePolicy = NamedChangePolicy | ChangeCheck;

/** One policy for everywhere, or one each for local runs and CI. */
export type Changes = ChangePolicy | { local: ChangePolicy; ci: ChangePolicy };

/** Lets the change happen, so it's left on disk to review and commit. */
export function allow(): NamedChangePolicy {
	return { name: "allow", check: () => {} };
}

/** Fails the test instead of changing steps. */
export function refuse(): NamedChangePolicy {
	return {
		name: "refuse",
		check: (change) => {
			const subject = change.intent ?? change.test;
			throw new IntentChangeRejectedError(
				`The changes policy refused a step change (${change.type}: "${subject}"). ` +
					"Run this where changes can be kept, then commit them.",
			);
		},
	};
}

export function resolveChangePolicy(
	changes: Changes,
	env: NodeJS.ProcessEnv = process.env,
): NamedChangePolicy {
	const policy =
		"local" in changes ? (env.CI ? changes.ci : changes.local) : changes;
	return typeof policy === "function"
		? { name: "custom", check: policy }
		: policy;
}
