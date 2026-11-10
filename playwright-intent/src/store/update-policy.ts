import { isReadOnlyPullRequest } from "../github/pull-request";
import type { StepUpdates } from "./store";

/** A built-in policy. The name tells the library how changes are kept. */
export interface UpdatePolicy {
	readonly name: "allow" | "refuse" | "commit" | "propose";
}

/** One policy for everywhere, or one each for local runs and CI. */
export type FileStoreUpdates =
	| UpdatePolicy
	| { local: UpdatePolicy; ci: UpdatePolicy };

/** Lets the change happen, so it's left on disk to review and commit. */
export function allow(): UpdatePolicy {
	return { name: "allow" };
}

/** Never runs the agent, so a missing step fails the test. */
export function refuse(): UpdatePolicy {
	return { name: "refuse" };
}

/**
 * Lets the agent make changes, and the reporter commits the ones from passing
 * tests to the pull request branch.
 */
export function commit(): UpdatePolicy {
	return { name: "commit" };
}

/**
 * Lets the agent make changes, but the test stays red. The reporter comments
 * the ones from passing tests on the pull request, for a person to apply.
 */
export function propose(): UpdatePolicy {
	return { name: "propose" };
}

export function resolveUpdatePolicy(
	updates: FileStoreUpdates,
	env: NodeJS.ProcessEnv,
): UpdatePolicy {
	const policy =
		"local" in updates ? (env.CI ? updates.ci : updates.local) : updates;
	const delivers = policy.name === "commit" || policy.name === "propose";
	// A fork's token can't deliver, and it has no model key to make a change.
	return delivers && isReadOnlyPullRequest(env) ? refuse() : policy;
}

/** What a file store policy means for the fixture and the reporter. */
export function fileStoreUpdates(policy: UpdatePolicy): StepUpdates {
	return {
		refused: policy.name === "refuse",
		delivered: policy.name === "commit" || policy.name === "propose",
		awaitsReview: policy.name === "propose",
	};
}
