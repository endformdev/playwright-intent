import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeGitHub } from "../harness/fake-github";
import { expect, flow } from "../harness/flow";
import type { Project } from "../harness/project";
import {
	CHECKOUT_TEST,
	CODE,
	checkoutScript,
	INTENT,
} from "../harness/shop-steps";

const FIXED_ADD = CODE.add.replace("Add blue shirt", "Buy blue shirt");
const ADD_FILE = `tests/checkout.spec.ts/checkout - guest buys a shirt/${INTENT.add}.ts`;
const REPO_FILE = `.intent/${ADD_FILE}`;

/** Generates the steps, then scripts a repair for one that's about to break. */
async function breakStep(project: Project, github: FakeGitHub) {
	await project.scriptAgent(checkoutScript());
	await project.run();
	github.files.set(REPO_FILE, await project.readStep(ADD_FILE));
	await project.scriptAgent({
		diagnose: {
			[INTENT.add]: [
				{
					explore: [FIXED_ADD],
					decision: {
						action: "repair",
						code: FIXED_ADD,
						page: "ready",
						reason: "The link was renamed by @someone <b>",
					},
				},
			],
		},
	});
}

/** A run with a broken step that the agent repairs, ready to be merged. */
async function repairInShard(
	project: Project,
	github: FakeGitHub,
	changes: "commit" | "propose",
) {
	await breakStep(project, github);
	return project.run({
		shop: "renamed-add-link",
		retries: 1,
		changes,
		shard: "1/1",
		github,
	});
}

/** Runs the block GitHub shows, the way someone copying it would. */
function applyComment(body: string, before: string, file: string): string {
	const script = /```+sh\n([\s\S]*?)\n```+/.exec(body)?.[1];
	if (!script) throw new Error(`No script in:\n${body}`);
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "apply-comment-"));
	const target = path.join(directory, file);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, before);
	execFileSync("git", ["init", "--quiet"], { cwd: directory });
	execFileSync("bash", ["-c", script], { cwd: directory });
	return fs.readFileSync(target, "utf8");
}

flow.describe("delivering through GitHub", () => {
	flow("commit puts one commit on the head", async ({ project, github }) => {
		await repairInShard(project, github, "commit");

		const merged = await project.mergeReports({ github });

		expect(merged.exitCode).toBe(0);
		expect(github.trees).toHaveLength(1);
		expect(github.trees[0]?.tree).toMatchObject([
			{ path: REPO_FILE, mode: "100644", type: "blob" },
		]);
		expect(github.trees[0]?.tree[0]?.content).toContain("Buy blue shirt");
		expect(github.commits).toMatchObject([
			{ parents: [FakeGitHub.HEAD_SHA], tree: "new-tree" },
		]);
		expect(github.refUpdates).toEqual([
			{
				route: `git/refs/heads/${FakeGitHub.HEAD_REF}`,
				sha: "bbbbbbb2222",
				force: false,
			},
		]);
		expect(github.comments).toEqual([]);
	});

	flow(
		"commit only needs permission to write contents",
		async ({ project, github }) => {
			await repairInShard(project, github, "commit");
			github.refuseComments = true;

			const merged = await project.mergeReports({ github });

			expect(merged.exitCode).toBe(0);
			expect(github.commits).toHaveLength(1);
		},
	);

	flow(
		"commit stays away from a head that moved",
		async ({ project, github }) => {
			await repairInShard(project, github, "commit");
			github.currentHead = "ccccccc3333";

			const merged = await project.mergeReports({ github });

			expect(merged.output).toContain("moved on from");
			expect(github.trees).toEqual([]);
		},
	);

	flow("propose posts a patch that applies", async ({ project, github }) => {
		const before = await (async () => {
			await repairInShard(project, github, "propose");
			return github.files.get(REPO_FILE) as string;
		})();

		await project.mergeReports({ github });

		expect(github.commits).toEqual([]);
		expect(github.comments).toHaveLength(1);
		const body = github.comments[0]?.body as string;
		expect(applyComment(body, before, REPO_FILE)).toBe(
			await project.readStep(ADD_FILE),
		);
		expect(body).toContain("@​someone &lt;b&gt;");
		expect(body.indexOf("<details>")).toBeGreaterThan(body.indexOf(ADD_FILE));
		expect(body.indexOf("<details>")).toBeLessThan(body.indexOf("git apply"));
		expect(body.indexOf("</details>")).toBeGreaterThan(
			body.indexOf("INTENT_PATCH\n```"),
		);
	});

	flow("a rerun updates the same comment", async ({ project, github }) => {
		await repairInShard(project, github, "propose");
		await project.mergeReports({ github });

		await project.mergeReports({ github });

		expect(github.comments).toHaveLength(1);
		expect(github.requests.filter((r) => r.startsWith("POST"))).toHaveLength(1);
	});

	flow(
		"a run with nothing to propose settles the comment",
		async ({ project, github }) => {
			await repairInShard(project, github, "propose");
			await project.mergeReports({ github });
			await project.scriptAgent({});
			await project.run({
				shop: "renamed-add-link",
				retries: 1,
				changes: "propose",
				shard: "1/1",
				github,
			});

			await project.mergeReports({ github });

			expect(github.comments[0]?.body).toContain("No step fixes to propose");
		},
	);

	flow(
		"the report carries the fix, with no .intent on the machine",
		async ({ project, github }) => {
			await repairInShard(project, github, "commit");
			await project.clearLocalSteps();

			await project.mergeReports({ github });

			expect(github.trees[0]?.tree[0]?.content).toContain("Buy blue shirt");
		},
	);

	flow("a delivery that fails turns red", async ({ project, github }) => {
		await repairInShard(project, github, "commit");
		github.refuseWrites = true;

		const merged = await project.mergeReports({ github });

		expect(merged.exitCode).toBe(1);
		expect(merged.output).toContain("Couldn't deliver the step changes");
		expect(merged.output).not.toContain("delivery-token");
	});

	flow(
		"a run that isn't sharded delivers itself",
		async ({ project, github }) => {
			await breakStep(project, github);

			const run = await project.run({
				shop: "renamed-add-link",
				changes: "commit",
				github,
			});

			expect(run.exitCode).toBe(0);
			expect(github.commits).toHaveLength(1);
			expect(run.output).not.toContain("delivery-token");
		},
	);

	flow(
		"one shard leaves delivery to merge-reports",
		async ({ project, github }) => {
			const run = await repairInShard(project, github, "commit");

			expect(github.requests).toEqual([]);
			expect(run.output).toContain("Not delivering from one shard");
			expect(run.reported.passed).toHaveLength(1);
		},
	);

	flow("a fork falls back to refuse", async ({ project, github }) => {
		await project.scriptAgent(checkoutScript());

		const run = await project.run({
			retries: 1,
			changes: "commit",
			github,
			fromFork: true,
		});

		expect(run.test(CHECKOUT_TEST).errors[0]).toContain(
			"The changes policy refused a step change",
		);
		expect(await project.agentCalls()).toEqual([]);
	});
});
