import { expect, flow } from "../harness/flow";
import type { Project } from "../harness/project";
import { CHECKOUT_TEST, checkoutScript, INTENT } from "../harness/shop-steps";

const REFUSED = "The changes policy refused a step change";

async function generateCheckout(project: Project) {
	await project.scriptAgent(checkoutScript());
	await project.run();
}

/** The project sets `changes: { local: allow(), ci: refuse() }`. */
flow.describe("changes", () => {
	flow("allow leaves the change on disk", async ({ project }) => {
		await project.scriptAgent(checkoutScript());

		const run = await project.run();

		expect(run.exitCode).toBe(0);
		expect(await project.stepFiles()).toHaveLength(3);
	});

	flow("refuse stops a miss before calling the agent", async ({ project }) => {
		await project.scriptAgent(checkoutScript());

		const run = await project.run({ ci: true });

		expect(run.exitCode).toBe(1);
		expect(run.test(CHECKOUT_TEST).errors[0]).toContain(
			`${REFUSED} (generate: "${INTENT.add}")`,
		);
		expect(await project.agentCalls()).toEqual([]);
		expect(await project.stepFiles()).toEqual([]);
	});

	flow("refuse leaves passing steps alone", async ({ project }) => {
		await generateCheckout(project);

		const run = await project.run({ ci: true });

		expect(run.exitCode).toBe(0);
	});

	flow("refuse doesn't need a model", async ({ project }) => {
		const run = await project.run({ ci: true, withoutAgent: true });

		expect(run.test(CHECKOUT_TEST).errors[0]).toContain(REFUSED);
	});

	flow("refuse fails a stale step and leaves it alone", async ({ project }) => {
		await generateCheckout(project);
		const before = await project.stepFiles();

		const run = await project.run({ shop: "renamed-add-link", ci: true });

		expect(run.exitCode).toBe(1);
		expect(run.test(CHECKOUT_TEST).errors[0]).toContain("Timeout 1000ms");
		expect(run.test(CHECKOUT_TEST).notes).toEqual([]);
		expect(await project.stepFiles()).toEqual(before);
		expect(await project.agentCalls()).toHaveLength(3);
	});

	flow(
		"a custom policy can generate but keep failures as failures",
		async ({ project }) => {
			await generateCheckout(project);
			const before = await project.stepFiles();

			const run = await project.run({
				shop: "renamed-add-link",
				generateOnly: true,
			});

			expect(run.test(CHECKOUT_TEST).errors[0]).toContain("Timeout 1000ms");
			expect(run.test(CHECKOUT_TEST).notes.join()).toContain(
				"No diagnoses here.",
			);
			expect(await project.stepFiles()).toEqual(before);
			expect(await project.agentCalls()).toHaveLength(3);
		},
	);

	flow("a single policy applies in CI too", async ({ project }) => {
		await project.scriptAgent(checkoutScript());

		const run = await project.run({ ci: true, allowEverywhere: true });

		expect(run.exitCode).toBe(0);
		expect(await project.stepFiles()).toHaveLength(3);
	});

	flow("a config without a store fails loudly", async ({ project }) => {
		const run = await project.run({ withoutStore: true });

		expect(run.test(CHECKOUT_TEST).errors[0]).toContain("Set use.intent.store");
	});
});
