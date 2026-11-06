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
export type ChangeHandler = (change: StepChange) => void | Promise<void>;

/** One handler for everywhere, or one each for local runs and CI. */
export type OnChange =
	| ChangeHandler
	| { local: ChangeHandler; ci: ChangeHandler };

/** Lets the change happen, so it's left on disk to review and commit. */
export function keep(): ChangeHandler {
	return () => {};
}

/** Fails the test instead of changing steps. */
export function fail(): ChangeHandler {
	return (change) => {
		const subject = change.intent ?? change.test;
		throw new IntentChangeRejectedError(
			`onChange rejected a step change (${change.type}: "${subject}"). ` +
				"Run this where changes can be kept, then commit them.",
		);
	};
}

export function resolveChangeHandler(
	onChange: OnChange,
	env: NodeJS.ProcessEnv = process.env,
): ChangeHandler {
	if (typeof onChange === "function") return onChange;
	return env.CI ? onChange.ci : onChange.local;
}
