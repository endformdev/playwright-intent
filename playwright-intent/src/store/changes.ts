import { IntentChangeRejectedError } from "../errors";
import { isReadOnlyPullRequest } from "../github/pull-request";

/** Something the library is about to do that could change saved steps. */
export interface StepChange {
	/**
	 * - `generate`: a step needs new code.
	 * - `diagnose`: the agent may repair or regenerate steps after a failure.
	 */
	type: "generate" | "diagnose";
	/** The test's describe and test titles, joined with ` > `. */
	test: string;
	/** Missing for failures outside a step. */
	intent?: string;
	/** The step's path inside `.intent`. Missing for failures outside a step. */
	key?: string;
	/** How many more times Playwright will retry this test after this attempt. */
	retriesLeft: number;
}

/**
 * Runs in the worker before the agent starts. Throw to stop the change, and
 * the test fails without spending anything on the model.
 */
export type ChangeCheck = (change: StepChange) => void | Promise<void>;

/** Policies that hand a run's proven changes to the reporter. */
export type ChangeDelivery = "commit" | "propose";

/** A policy the library can identify. `custom` is a user's own function. */
export interface NamedChangePolicy {
	readonly name: "allow" | "refuse" | "custom" | ChangeDelivery;
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
			const file = change.key ? ` at .intent/${change.key}` : "";
			throw new IntentChangeRejectedError(
				`The changes policy refused a step change (${change.type}: "${subject}")${file}. ` +
					"Run this where changes can be kept, then commit them.",
			);
		},
	};
}

/**
 * Proves each change on a retry, then the reporter collects the proven ones
 * for the pull request branch. The test passes, and shows as flaky.
 */
export function commit(): NamedChangePolicy {
	return deliveryPolicy("commit");
}

/**
 * Proves each change on a retry, but the test stays red. The reporter collects
 * the proven changes for a person to apply.
 */
export function propose(): NamedChangePolicy {
	return deliveryPolicy("propose");
}

function deliveryPolicy(name: ChangeDelivery): NamedChangePolicy {
	return {
		name,
		check: (change) => {
			if (change.retriesLeft > 0) return;
			const subject = change.intent ?? change.test;
			throw new IntentChangeRejectedError(
				`${name}() needs a retry to prove a step change, and this attempt has none left (${change.type}: "${subject}"). ` +
					"Each change uses one retry, so raise retries in the Playwright config.",
			);
		},
	};
}

/** Null for policies that leave changes where they are. */
export function deliveryOf(policy: NamedChangePolicy): ChangeDelivery | null {
	return policy.name === "commit" || policy.name === "propose"
		? policy.name
		: null;
}

export function resolveChangePolicy(
	changes: Changes,
	env: NodeJS.ProcessEnv = process.env,
): NamedChangePolicy {
	const policy =
		"local" in changes ? (env.CI ? changes.ci : changes.local) : changes;
	const named: NamedChangePolicy =
		typeof policy === "function" ? { name: "custom", check: policy } : policy;
	// A fork's token can't deliver, and it has no model key to make a change.
	return deliveryOf(named) && isReadOnlyPullRequest(env) ? refuse() : named;
}
