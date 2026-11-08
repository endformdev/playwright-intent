import { expect, flow } from "../harness/flow";
import type { Project } from "../harness/project";
import { CHECKOUT_TEST, checkoutScript, INTENT } from "../harness/shop-steps";

const REFUSED = "The changes policy refused a step change";

async function generateCheckout(project: Project) {
	await project.scriptAgent(checkoutScript());
	await project.run({ mode: "missing" });
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

	flow("refuse stops all mode clearing steps", async ({ project }) => {
		await generateCheckout(project);
		const before = await project.stepFiles();

		const run = await project.run({ mode: "all", ci: true });

		expect(run.test(CHECKOUT_TEST).errors[0]).toContain(`${REFUSED} (clear`);
		expect(await project.stepFiles()).toEqual(before);
		expect(await project.agentCalls()).toHaveLength(3);
	});

	flow(
		"refuse skips diagnosis, and the test keeps its own error",
		async ({ project }) => {
			await generateCheckout(project);

			const run = await project.run({
				mode: "changed",
				shop: "renamed-add-link",
				ci: true,
			});

			expect(run.test(CHECKOUT_TEST).errors[0]).toContain("Timeout 1000ms");
			expect(run.output).toContain(`${REFUSED} (diagnose: "${INTENT.add}")`);
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
