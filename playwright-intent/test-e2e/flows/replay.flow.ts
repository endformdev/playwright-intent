import { expect, flow } from "../harness/flow";
import { CODE, checkoutScript, INTENT, solved } from "../harness/shop-steps";

flow.describe("replaying steps", () => {
	flow(
		"the next run replays without calling the agent",
		async ({ project }) => {
			await project.scriptAgent(checkoutScript());
			await project.run();
			const callsAfterGenerating = (await project.agentCalls()).length;

			const replay = await project.run({ ci: true });

			expect(replay.exitCode).toBe(0);
			expect(await project.agentCalls()).toHaveLength(callsAfterGenerating);
		},
	);

	flow("rewording an intent regenerates it", async ({ project }) => {
		const script = checkoutScript();
		script.generate["add the blue shirt to my cart"] = [solved(CODE.add)];
		await project.scriptAgent(script);
		await project.run();

		await project.replaceInFile(
			"tests/checkout.spec.ts",
			INTENT.add,
			"add the blue shirt to my cart",
		);
		const run = await project.run();

		expect(run.exitCode).toBe(0);
		const reworded = await project.agentCalls();
		expect(reworded.at(-1)?.intent).toBe("add the blue shirt to my cart");
	});

	flow(
		"a change only in casing is a miss on the same file",
		async ({ project }) => {
			const script = checkoutScript();
			script.generate["Add the blue shirt to the cart"] = [solved(CODE.add)];
			await project.scriptAgent(script);
			await project.run();
			const stepsBefore = await project.stepFiles();

			await project.replaceInFile(
				"tests/checkout.spec.ts",
				INTENT.add,
				"Add the blue shirt to the cart",
			);
			const run = await project.run();

			expect(run.exitCode).toBe(0);
			expect(await project.stepFiles()).toEqual(stepsBefore);
		},
	);

	flow("a miss generates by default", async ({ project }) => {
		await project.scriptAgent(checkoutScript());

		const run = await project.run();

		expect(run.exitCode).toBe(0);
	});

	flow("deleting a step generates it again", async ({ project }) => {
		await project.scriptAgent(checkoutScript());
		await project.run();

		await project.scriptAgent({
			generate: {
				[INTENT.add]: [solved(CODE.add), solved(CODE.add)],
				[INTENT.checkout]: [solved(CODE.checkout), solved(CODE.checkout)],
				[INTENT.pay]: [solved(CODE.pay), solved(CODE.pay)],
			},
		});
		await project.clearLocalSteps();
		const run = await project.run();

		expect(run.exitCode).toBe(0);
		expect(await project.agentCalls()).toHaveLength(6);
	});
});
