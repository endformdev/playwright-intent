import type { LocalCacheApi } from "../harness/cache-api";
import { expect, flow } from "../harness/flow";
import type { Project } from "../harness/project";
import {
	CHECKOUT_TEST,
	CODE,
	checkoutScript,
	INTENT,
	solved,
	STEP_FILE,
} from "../harness/shop-steps";

const ADD_FILE = STEP_FILE.add;
const FIXED_ADD = CODE.add.replace("Add blue shirt", "Buy blue shirt");

/** A CI run that generates the checkout steps and uploads them. */
async function uploadCheckout(project: Project): Promise<void> {
	await project.scriptAgent(checkoutScript());
	const run = await project.run({ ci: true });
	expect(run.exitCode).toBe(0);
	await project.clearLocalSteps();
	await project.scriptAgent({});
}

async function remoteKeys(cacheApi: LocalCacheApi): Promise<string[]> {
	return Object.keys(await cacheApi.steps()).sort();
}

flow.describe("remote store", () => {
	flow(
		"the first CI run generates and uploads its steps",
		async ({ createProject, cacheApi }) => {
			const project = await createProject({ cacheApi });
			await project.scriptAgent(checkoutScript());

			const run = await project.run({ ci: true });

			expect(run.exitCode).toBe(0);
			// A 404 means nothing is stored yet, so every step is generated.
			expect(cacheApi.requests).toEqual([
				"GET main 404",
				"GET main 404",
				"PUT main 204",
			]);
			expect(await project.agentCalls()).toHaveLength(3);
			expect(await remoteKeys(cacheApi)).toEqual(await project.stepFiles());
			expect(run.output).toContain("Uploaded 3 step change(s)");
		},
	);

	flow(
		"the next CI run replays from the store without the agent",
		async ({ createProject, cacheApi }) => {
			const project = await createProject({ cacheApi });
			await uploadCheckout(project);
			cacheApi.requests.length = 0;

			const run = await project.run({ ci: true });

			expect(run.exitCode).toBe(0);
			expect(run.test(CHECKOUT_TEST).attempts).toEqual(["passed"]);
			expect(cacheApi.requests).toEqual(["GET main 200"]);
			expect(await project.stepFiles()).toEqual(await remoteKeys(cacheApi));
		},
	);

	flow(
		"a CI repair uploads the fixed step",
		async ({ createProject, cacheApi }) => {
			const project = await createProject({ cacheApi });
			await uploadCheckout(project);
			await project.scriptAgent({
				diagnose: {
					[INTENT.add]: [
						{
							explore: [FIXED_ADD],
							decision: {
								action: "repair",
								code: FIXED_ADD,
								page: "ready",
								reason: "The link was renamed.",
							},
						},
					],
				},
			});

			const run = await project.run({ ci: true, shop: "renamed-add-link" });

			expect(run.exitCode).toBe(0);
			expect((await cacheApi.steps())[ADD_FILE]).toContain("Buy blue shirt");
			expect(await remoteKeys(cacheApi)).toHaveLength(3);
		},
	);

	flow(
		"a local run downloads steps but never uploads",
		async ({ createProject, cacheApi }) => {
			const project = await createProject({ cacheApi });
			await uploadCheckout(project);
			const stored = await cacheApi.steps();
			await project.replaceInFile(
				"tests/checkout.spec.ts",
				INTENT.add,
				"put the blue shirt in the cart",
			);
			await project.scriptAgent({
				generate: { "put the blue shirt in the cart": [solved(CODE.add)] },
			});
			cacheApi.requests.length = 0;

			const run = await project.run();

			expect(run.exitCode).toBe(0);
			const calls = await project.agentCalls();
			expect(calls.at(-1)?.intent).toBe("put the blue shirt in the cart");
			expect(calls).toHaveLength(4);
			expect(cacheApi.requests).toEqual(["GET main 200"]);
			expect(await cacheApi.steps()).toEqual(stored);
			expect(run.test(CHECKOUT_TEST).attachments).not.toContain(
				"intent-change",
			);
		},
	);

	flow(
		"test folders already on disk are left alone",
		async ({ createProject, cacheApi }) => {
			const project = await createProject({ cacheApi });
			await uploadCheckout(project);
			const stored = await cacheApi.steps();
			const local = (stored[ADD_FILE] ?? "").replace(
				"Add blue shirt",
				"Add blue shirt ",
			);
			await project.writeStep(ADD_FILE, local);

			await project.run();

			// The folder was on disk, so the other two steps weren't downloaded.
			expect(await project.stepFiles()).toEqual([ADD_FILE]);
			expect(await project.readStep(ADD_FILE)).toBe(local);
		},
	);

	flow(
		"sharded runs upload once, from merge-reports",
		async ({ createProject, cacheApi }) => {
			const project = await createProject({ cacheApi });
			await project.writeFile(
				"tests/second.spec.ts",
				`import { test } from "./fixtures";

test("second", async ({ page, ai }) => {
	await page.goto("/");
	await ai.do("put the blue shirt in the cart");
});
`,
			);
			await project.scriptAgent({
				generate: {
					...checkoutScript().generate,
					"put the blue shirt in the cart": [solved(CODE.add)],
				},
			});
			const files = ["tests/checkout.spec.ts", "tests/second.spec.ts"];

			await project.run({ ci: true, files, shard: "1/2" });
			await project.run({ ci: true, files, shard: "2/2" });
			expect(cacheApi.requests).toEqual(["GET main 404", "GET main 404"]);
			const merged = await project.mergeReports({ ci: true });

			expect(merged.exitCode).toBe(0);
			// merge-reports downloads too, which it doesn't need but doesn't mind.
			expect(cacheApi.requests.slice(2)).toEqual([
				"GET main 404",
				"GET main 404",
				"PUT main 204",
			]);
			expect(await remoteKeys(cacheApi)).toHaveLength(4);
		},
	);

	flow(
		"merge-reports doesn't mind a failed download",
		async ({ createProject, cacheApi }) => {
			const project = await createProject({ cacheApi });
			await uploadCheckout(project);
			await project.run({ ci: true, shard: "1/1" });
			cacheApi.outage = true;
			cacheApi.requests.length = 0;

			const merged = await project.mergeReports({ ci: true });

			// It has nothing to deliver, so the download is the only request.
			expect(merged.exitCode).toBe(0);
			expect(cacheApi.requests).toEqual(["GET main 500"]);
		},
	);

	flow(
		"--list doesn't mind a failed download",
		async ({ createProject, cacheApi }) => {
			const project = await createProject({ cacheApi });
			cacheApi.outage = true;

			const listed = await project.list();

			expect(listed.exitCode).toBe(0);
			expect(listed.output).toContain("Total: 1 test in 1 file");
			expect(cacheApi.requests).toEqual(["GET main 500"]);
		},
	);

	flow(
		"an outage fails the tests instead of regenerating",
		async ({ createProject, cacheApi }) => {
			const project = await createProject({ cacheApi });
			await uploadCheckout(project);
			cacheApi.outage = true;

			const run = await project.run({ ci: true });

			expect(run.exitCode).toBe(1);
			expect(run.test(CHECKOUT_TEST).errors[0]).toContain(
				"Couldn't download steps",
			);
			// Only the first run's three generations: nothing was regenerated.
			expect(await project.agentCalls()).toHaveLength(3);
			expect(await project.stepFiles()).toEqual([]);
		},
	);

	flow(
		"a wrong token says to check it",
		async ({ createProject, cacheApi }) => {
			const project = await createProject({ cacheApi });

			const run = await project.run({ ci: true, cacheToken: "wrong" });

			expect(run.exitCode).toBe(1);
			expect(run.test(CHECKOUT_TEST).errors[0]).toContain("401");
			expect(run.output).toContain("Check the remote store's token.");
		},
	);

	flow(
		"a config without the reporter fails loudly",
		async ({ createProject, cacheApi }) => {
			const project = await createProject({ cacheApi });
			await project.scriptAgent(checkoutScript());

			const run = await project.run({ withoutReporter: true });

			expect(run.exitCode).toBe(1);
			expect(run.test(CHECKOUT_TEST).errors[0]).toContain(
				"remoteStore downloads steps from playwright-intent/reporter",
			);
			expect(cacheApi.requests).toEqual([]);
		},
	);

	flow(
		"a reporter without options fails before tests run",
		async ({ createProject, cacheApi }) => {
			const project = await createProject({ cacheApi });

			const run = await project.run({ withoutReporterOptions: true });

			expect(run.exitCode).toBe(1);
			expect(run.output).toContain(
				"pass the reporter the same options as use.intent",
			);
			expect(cacheApi.requests).toEqual([]);
		},
	);
});
