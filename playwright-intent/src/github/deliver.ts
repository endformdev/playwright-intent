import path from "node:path";
import type { ChangeSet, RunChange } from "../reporter/change-set";
import {
	COMMENT_MARKER,
	renderProposalComment,
	renderSettledComment,
} from "./comment";
import { encodePath, GitHub, GitHubError } from "./github-api";
import { buildPatch } from "./patch";
import {
	isReadOnlyPullRequest,
	type PullRequestEvent,
	readPullRequestEvent,
} from "./pull-request";

export interface DeliveryOptions {
	changes: ChangeSet;
	/** The `.intent` folder. */
	root: string;
	env: NodeJS.ProcessEnv;
	/** One shard only sees part of a run, so merge-reports delivers instead. */
	sharded: boolean;
}

type TreeEntry = {
	path: string;
	mode: "100644";
	type: "blob";
	content?: string;
	sha?: null;
};

interface Delivery {
	github: GitHub;
	pullRequest: PullRequestEvent;
	repoPath(key: string): string;
}

function log(message: string): void {
	console.log(`[intent] ${message}`);
}

/** Throws when something should have been delivered and couldn't be. */
export async function deliverChanges({
	changes,
	root,
	env,
	sharded,
}: DeliveryOptions): Promise<void> {
	if (env.GITHUB_ACTIONS !== "true") return;
	const commits = changes.passed.filter(
		({ delivery }) => delivery === "commit",
	);
	const proposals = changes.passed.filter(
		({ delivery }) => delivery === "propose",
	);
	const diagnoses = changes.diagnoses.filter(
		({ delivery }) => delivery === "propose",
	);
	const pending = commits.length + proposals.length + diagnoses.length > 0;

	if (sharded) {
		if (pending) {
			log(
				"Not delivering from one shard of a run. Run playwright merge-reports " +
					"to deliver the whole run.",
			);
		}
		return;
	}
	const pullRequest = readPullRequestEvent(env);
	if (!pullRequest) {
		if (pending)
			log("This run isn't for a pull request, so nothing was delivered.");
		return;
	}
	if (isReadOnlyPullRequest(env)) return;
	const token = env.GITHUB_TOKEN;
	if (!token) {
		if (!pending) return;
		throw new Error("Set GITHUB_TOKEN on this step to deliver step changes.");
	}

	const prefix = repositoryPrefix(root, env);
	const delivery: Delivery = {
		github: new GitHub({
			apiUrl: env.GITHUB_API_URL ?? "https://api.github.com",
			token,
			repository: pullRequest.base.repo.full_name,
		}),
		pullRequest,
		repoPath: (key) => path.posix.join(prefix, key),
	};

	if (commits.length > 0) await commitChanges(delivery, commits);
	await updateComment(delivery, proposals, diagnoses);
}

/** `.intent` relative to the repository, which may not be its root. */
function repositoryPrefix(root: string, env: NodeJS.ProcessEnv): string {
	const relative = path.relative(
		env.GITHUB_WORKSPACE ?? path.dirname(root),
		root,
	);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new Error(`${root} is outside the GitHub workspace.`);
	}
	return relative.split(path.sep).join("/");
}

/**
 * One commit on the pull request's head through the API. A `pull_request` run
 * checks out a merge commit, so pushing from it would push the wrong thing.
 */
async function commitChanges(
	{ github, pullRequest, repoPath }: Delivery,
	changes: RunChange[],
): Promise<void> {
	const { sha, ref } = pullRequest.head;
	// `git/ref` only needs `contents`, unlike reading the pull request.
	const current = await github.json<{ object: { sha: string } }>(
		"GET",
		`git/ref/heads/${encodePath(ref)}`,
	);
	if (current.object.sha !== sha) {
		log(`Not committing: the pull request moved on from ${sha.slice(0, 7)}.`);
		return;
	}

	const entries: TreeEntry[] = [];
	for (const change of changes) {
		const file = repoPath(change.key);
		const entry = { path: file, mode: "100644", type: "blob" } as const;
		if (change.source !== undefined) {
			entries.push({ ...entry, content: change.source });
		} else if ((await github.readFile(file, sha)) !== null) {
			// Git rejects deleting a path the head doesn't have.
			entries.push({ ...entry, sha: null });
		}
	}
	if (entries.length === 0) return;

	const head = await github.json<{ tree: { sha: string } }>(
		"GET",
		`git/commits/${sha}`,
	);
	const tree = await github.json<{ sha: string }>("POST", "git/trees", {
		base_tree: head.tree.sha,
		tree: entries,
	});
	if (tree.sha === head.tree.sha) {
		log("These step changes are already on the pull request.");
		return;
	}
	const commit = await github.json<{ sha: string }>("POST", "git/commits", {
		message: commitMessage(changes, repoPath),
		tree: tree.sha,
		parents: [sha],
	});
	await github.json("PATCH", `git/refs/heads/${encodePath(ref)}`, {
		sha: commit.sha,
		force: false,
	});
	log(
		`Committed ${entries.length} step change(s) as ${commit.sha.slice(0, 7)}.`,
	);
}

function commitMessage(
	changes: RunChange[],
	repoPath: (key: string) => string,
): string {
	const lines = changes.map(({ key, kind, cause, reason }) => {
		const because = reason ? `: ${reason.replace(/\s+/g, " ")}` : "";
		return `- ${kind === "delete" ? "delete" : cause} ${repoPath(key)}${because}`;
	});
	return `Update Playwright Intent steps\n\n${lines.join("\n")}`;
}

/** Keeps one comment up to date, so reruns don't pile up. */
async function updateComment(
	{ github, pullRequest, repoPath }: Delivery,
	proposals: RunChange[],
	diagnoses: ChangeSet["diagnoses"],
): Promise<void> {
	const { sha } = pullRequest.head;

	if (proposals.length === 0 && diagnoses.length === 0) {
		// `commit()` only needs `contents: write`, which can't read comments.
		const existing = await findComment(github, pullRequest.number).catch(
			(error) => {
				if (error instanceof GitHubError && error.status === 403) return null;
				throw error;
			},
		);
		if (existing) {
			await github.json("PATCH", `issues/comments/${existing}`, {
				body: renderSettledComment(sha),
			});
		}
		return;
	}

	const files = await Promise.all(
		proposals.map(async ({ key, source }) => {
			const file = repoPath(key);
			return {
				path: file,
				before: await github.readFile(file, sha),
				after: source ?? null,
			};
		}),
	);
	const patch = proposals.length > 0 ? await buildPatch(files) : "";
	const body = renderProposalComment({
		sha,
		proposals: proposals.map((change) => ({
			...change,
			path: repoPath(change.key),
		})),
		diagnoses,
		patch,
	});
	if (patch && !body.includes("INTENT_PATCH")) console.log(patch);

	const existing = await findComment(github, pullRequest.number);
	if (existing) {
		await github.json("PATCH", `issues/comments/${existing}`, { body });
	} else {
		await github.json("POST", `issues/${pullRequest.number}/comments`, {
			body,
		});
	}
	log(`Updated the step changes comment on #${pullRequest.number}.`);
}

async function findComment(
	github: GitHub,
	number: number,
): Promise<number | null> {
	for (let page = 1; ; page++) {
		const comments = await github.json<
			{ id: number; body?: string; user?: { type?: string } }[]
		>("GET", `issues/${number}/comments?per_page=100&page=${page}`);
		const ours = comments.find(
			({ body, user }) =>
				user?.type === "Bot" && body?.startsWith(COMMENT_MARKER),
		);
		if (ours) return ours.id;
		if (comments.length < 100) return null;
	}
}
