import { expect, flow } from "../harness/flow";
import {
	CHECKOUT_TEST,
	CODE,
	checkoutScript,
	INTENT,
	solved,
	solvedButDirty,
} from "../harness/shop-steps";

flow.describe("replaying steps", () => {
	flow(
		"the next run replays without calling the agent",
		async ({ project }) => {
			await project.scriptAgent(checkoutScript());
			await project.run({ mode: "missing" });
			const callsAfterGenerating = (await project.agentCalls()).length;

			const replay = await project.run({ mode: "none" });

			expect(replay.exitCode).toBe(0);
			expect(await project.agentCalls()).toHaveLength(callsAfterGenerating);
		},
	);

	flow("none fails on a miss and names the step", async ({ project }) => {
		const run = await project.run({ mode: "none" });

		expect(run.exitCode).toBe(1);
		expect(run.test(CHECKOUT_TEST).errors[0]).toContain(
			"No step at .intent/tests/checkout.spec.ts/",
		);
		expect(await project.agentCalls()).toEqual([]);
	});

	for (const mode of ["none", "missing"] as const) {
		flow(
			`${mode} fails on a stale step and leaves it alone`,
			async ({ project }) => {
				await project.scriptAgent(checkoutScript());
				await project.run({ mode: "missing" });
				const stepsBefore = await project.stepFiles();
				const callsBefore = (await project.agentCalls()).length;

				const run = await project.run({ mode, shop: "renamed-add-link" });

				expect(run.exitCode).toBe(1);
				expect(run.test(CHECKOUT_TEST).errors[0]).toContain("TimeoutError");
				expect(await project.stepFiles()).toEqual(stepsBefore);
				expect(await project.agentCalls()).toHaveLength(callsBefore);
			},
		);
	}

	flow("rewording an intent regenerates it", async ({ project }) => {
		const script = checkoutScript();
		script.generate["add the blue shirt to my cart"] = [solved(CODE.add)];
		await project.scriptAgent(script);
		await project.run({ mode: "missing" });

		await project.replaceInFile(
			"tests/checkout.spec.ts",
			INTENT.add,
			"add the blue shirt to my cart",
		);
		const run = await project.run({ mode: "missing" });

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
			await project.run({ mode: "missing" });
			const stepsBefore = await project.stepFiles();

			await project.replaceInFile(
				"tests/checkout.spec.ts",
				INTENT.add,
				"Add the blue shirt to the cart",
			);
			const run = await project.run({ mode: "missing" });

			expect(run.exitCode).toBe(0);
			expect(await project.stepFiles()).toEqual(stepsBefore);
		},
	);

	flow("PW_INTENT overrides use.intent.mode", async ({ project }) => {
		await project.scriptAgent(checkoutScript());

		const run = await project.run({ mode: "missing", configMode: "none" });

		expect(run.exitCode).toBe(0);
	});

	flow("use.intent.mode applies without PW_INTENT", async ({ project }) => {
		const run = await project.run({ configMode: "none" });

		expect(run.test(CHECKOUT_TEST).errors[0]).toContain('mode is "none"');
	});

	flow("CI never generates unless told to", async ({ project }) => {
		await project.scriptAgent(checkoutScript());

		const run = await project.run({ ci: true });

		expect(run.exitCode).toBe(1);
		expect(await project.agentCalls()).toEqual([]);
	});

	flow("outside CI, a miss generates by default", async ({ project }) => {
		await project.scriptAgent(checkoutScript());

		const run = await project.run();

		expect(run.exitCode).toBe(0);
	});

	flow("all regenerates every step that runs", async ({ project }) => {
		await project.scriptAgent(checkoutScript());
		await project.run({ mode: "missing" });

		await project.scriptAgent({
			generate: {
				[INTENT.add]: [solved(CODE.add), solved(CODE.add)],
				[INTENT.checkout]: [solved(CODE.checkout), solved(CODE.checkout)],
				[INTENT.pay]: [solved(CODE.pay), solved(CODE.pay)],
			},
		});
		const run = await project.run({ mode: "all" });

		expect(run.exitCode).toBe(0);
		expect(await project.agentCalls()).toHaveLength(6);
	});

	flow("all doesn't regenerate again on a retry", async ({ project }) => {
		await project.scriptAgent(checkoutScript());
		await project.run({ mode: "missing" });
		await project.scriptAgent({
			generate: {
				[INTENT.add]: [solved(CODE.add), solvedButDirty(CODE.add)],
				[INTENT.checkout]: [solved(CODE.checkout), solved(CODE.checkout)],
				[INTENT.pay]: [solved(CODE.pay), solved(CODE.pay)],
			},
		});

		const run = await project.run({ mode: "all", retries: 2 });

		expect(run.test(CHECKOUT_TEST).attempts).toEqual(["failed", "passed"]);
		const calls = await project.agentCalls();
		const added = calls.filter((call) => call.intent === INTENT.add);
		expect(added).toHaveLength(2);
		expect(calls).toHaveLength(6);
	});

	flow("all removes steps the test no longer uses", async ({ project }) => {
		await project.scriptAgent(checkoutScript());
		await project.run({ mode: "missing" });
		await project.replaceInFile(
			"tests/checkout.spec.ts",
			'await ai.do("go to checkout");',
			'await ai.do("open the checkout");',
		);
		await project.scriptAgent({
			generate: {
				[INTENT.add]: [solved(CODE.add), solved(CODE.add)],
				"open the checkout": [solved(CODE.checkout)],
				[INTENT.pay]: [solved(CODE.pay), solved(CODE.pay)],
			},
		});

		await project.run({ mode: "all" });

		const steps = (await project.stepFiles()).join("\n");
		expect(steps).toContain("open the checkout.ts");
		expect(steps).not.toContain(`${INTENT.checkout}.ts`);
	});
});
