import { expect, flow } from "../harness/flow";
import type { Project } from "../harness/project";
import { CHECKOUT_TEST, checkoutScript, INTENT } from "../harness/shop-steps";

const REJECTED = "onChange rejected a step change";

async function generateCheckout(project: Project) {
	await project.scriptAgent(checkoutScript());
	await project.run({ mode: "missing" });
}

/** The project sets `onChange: { local: keep(), ci: fail() }`. */
flow.describe("onChange", () => {
	flow("local keeps the change on disk", async ({ project }) => {
		await project.scriptAgent(checkoutScript());

		const run = await project.run();

		expect(run.exitCode).toBe(0);
		expect(await project.stepFiles()).toHaveLength(3);
	});

	flow("fail rejects a miss before calling the agent", async ({ project }) => {
		await project.scriptAgent(checkoutScript());

		const run = await project.run({ ci: true });

		expect(run.exitCode).toBe(1);
		expect(run.test(CHECKOUT_TEST).errors[0]).toContain(
			`${REJECTED} (generate: "${INTENT.add}")`,
		);
		expect(await project.agentCalls()).toEqual([]);
		expect(await project.stepFiles()).toEqual([]);
	});

	flow("fail leaves passing steps alone", async ({ project }) => {
		await generateCheckout(project);

		const run = await project.run({ ci: true });

		expect(run.exitCode).toBe(0);
	});

	flow("fail stops all mode clearing steps", async ({ project }) => {
		await generateCheckout(project);
		const before = await project.stepFiles();

		const run = await project.run({ mode: "all", ci: true });

		expect(run.test(CHECKOUT_TEST).errors[0]).toContain(`${REJECTED} (clear`);
		expect(await project.stepFiles()).toEqual(before);
		expect(await project.agentCalls()).toHaveLength(3);
	});

	flow(
		"fail skips diagnosis, and the test keeps its own error",
		async ({ project }) => {
			await generateCheckout(project);

			const run = await project.run({
				mode: "changed",
				shop: "renamed-add-link",
				ci: true,
			});

			expect(run.test(CHECKOUT_TEST).errors[0]).toContain("Timeout 1000ms");
			expect(run.output).toContain(`${REJECTED} (diagnose: "${INTENT.add}")`);
			expect(await project.agentCalls()).toHaveLength(3);
		},
	);

	flow("a single function applies in CI too", async ({ project }) => {
		await project.scriptAgent(checkoutScript());

		const run = await project.run({ ci: true, keepEverywhere: true });

		expect(run.exitCode).toBe(0);
		expect(await project.stepFiles()).toHaveLength(3);
	});

	flow("a config without a store fails loudly", async ({ project }) => {
		const run = await project.run({ withoutStore: true });

		expect(run.test(CHECKOUT_TEST).errors[0]).toContain("Set use.intent.store");
	});
});
