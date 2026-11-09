import fs from "node:fs";

export interface PullRequestEvent {
	number: number;
	user?: { login: string };
	head: { sha: string; ref: string; repo: { full_name: string } | null };
	base: { repo: { full_name: string } };
}

/** The pull request this GitHub Actions run is for, if there is one. */
export function readPullRequestEvent(
	env: NodeJS.ProcessEnv,
): PullRequestEvent | null {
	if (env.GITHUB_EVENT_NAME !== "pull_request" || !env.GITHUB_EVENT_PATH) {
		return null;
	}
	try {
		const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
		return event.pull_request ?? null;
	} catch {
		return null;
	}
}

/** Forks and Dependabot get a read-only token and no secrets. */
export function isReadOnlyPullRequest(env: NodeJS.ProcessEnv): boolean {
	const pullRequest = readPullRequestEvent(env);
	if (!pullRequest) return false;
	const { head, base, user } = pullRequest;
	return (
		head.repo?.full_name !== base.repo.full_name ||
		user?.login === "dependabot[bot]"
	);
}
