import { expect, flow } from "../harness/flow";
import { CHECKOUT_TEST, CODE, INTENT } from "../harness/shop-steps";
import type { ModelTurn } from "../project/scripted-model";

const STEP_FILE = `tests/checkout.spec.ts/checkout - guest buys a shirt/${INTENT.add}.ts`;

const steps: [string, ModelTurn["input"]["code"]][] = [
	[INTENT.add, CODE.add],
	[INTENT.checkout, CODE.checkout],
	[INTENT.pay, CODE.pay],
];

const solveEveryStep: ModelTurn[] = steps.flatMap(([, code]) => [
	{ tool: "run", input: { code } },
	{ tool: "finish", input: { code, page: "ready" } },
]);

flow.describe("the built-in agent", () => {
	flow(
		"saves the code the model finishes with, then replays it",
		async ({ project }) => {
			await project.scriptModel({ turns: solveEveryStep });

			const generated = await project.run();
			const replayed = await project.run({ ci: true });

			expect(generated.exitCode).toBe(0);
			expect(replayed.exitCode).toBe(0);
			expect(await project.readStep(STEP_FILE)).toContain(
				'getByRole("link", { name: "Add blue shirt" })',
			);
			expect(await project.modelCalls()).toHaveLength(solveEveryStep.length);
		},
	);

	flow(
		"shows the model the test file with its step marked",
		async ({ project }) => {
			await project.scriptModel({ turns: solveEveryStep });

			await project.run();

			const [firstCall] = await project.modelCalls();
			expect(firstCall).toContain(`>> \\t\\tawait ai.do(\\"${INTENT.add}\\");`);
			expect(firstCall).toContain('name: \\"Thank you\\"');
		},
	);

	flow("shows the model test ids from the page", async ({ project }) => {
		await project.scriptModel({ turns: solveEveryStep });
		await project.replaceInFile(
			"shop/app.ts",
			'<a href="/checkout">',
			'<a data-testid="to-checkout" href="/checkout">',
		);

		await project.run();

		const [, afterFirstRun] = await project.modelCalls();
		expect(afterFirstRun).toContain("Test ids on this page");
		expect(afterFirstRun).toContain("to-checkout: <a> Checkout");
	});

	flow("attaches a transcript to the test", async ({ project }) => {
		await project.scriptModel({ turns: solveEveryStep });

		const run = await project.run();

		expect(run.test(CHECKOUT_TEST).attachments).toContain(
			`agent: ${INTENT.add}`,
		);
	});

	flow(
		"failing a step fails the test and saves nothing",
		async ({ project }) => {
			await project.scriptModel({
				turns: [{ tool: "fail", input: { reason: "There's no shirt." } }],
			});

			const run = await project.run();

			expect(run.exitCode).toBe(1);
			expect(run.test(CHECKOUT_TEST).errors[0]).toContain("There's no shirt.");
			expect(await project.stepFiles()).toEqual([]);
			const [firstCall] = await project.modelCalls();
			expect(firstCall).toContain('"name":"fail"');
			expect(firstCall).not.toContain("give_up");
		},
	);

	flow("running out of turns saves nothing", async ({ project }) => {
		const look: ModelTurn = { tool: "look", input: {} };
		await project.scriptModel({ turns: [look, look], limits: { maxTurns: 2 } });

		const run = await project.run();

		expect(run.exitCode).toBe(1);
		expect(run.test(CHECKOUT_TEST).errors[0]).toContain("within 2 turns");
		expect(await project.modelCalls()).toHaveLength(2);
		expect(await project.stepFiles()).toEqual([]);
	});

	flow("custom prompts can build on the defaults", async ({ project }) => {
		await project.scriptModel({ turns: solveEveryStep });

		await project.run({
			generatePrompt: "{default}\n\nThis shop sells shirts.",
		});

		const [firstCall] = await project.modelCalls();
		expect(firstCall).toContain("You turn one natural-language step");
		expect(firstCall).toContain("This shop sells shirts.");
	});

	flow(
		"a replaced prompt keeps the tools' instructions",
		async ({ project }) => {
			await project.scriptModel({ turns: solveEveryStep });

			const run = await project.run({
				generatePrompt: "Only these words.",
			});

			const [firstCall] = await project.modelCalls();
			expect(run.exitCode).toBe(0);
			expect(firstCall).toContain("Only these words.");
			expect(firstCall).not.toContain("You turn one natural-language step");
			expect(firstCall).toContain("Actions time out after 5 seconds");
			expect(firstCall).toContain("`dirty` if your code is right");
		},
	);

	flow("custom prompts reach a diagnosis", async ({ project }) => {
		await project.scriptModel({
			turns: [
				...solveEveryStep,
				{ tool: "fail", input: { reason: "Checked." } },
			],
		});
		await project.run();

		await project.run({
			shop: "renamed-add-link",
			diagnosePrompt: "{default}\n\nCheck the cart first.",
		});

		const diagnosis = (await project.modelCalls()).at(-1);
		expect(diagnosis).toContain("A Playwright test just failed.");
		expect(diagnosis).toContain("Check the cart first.");
		expect(diagnosis).toContain('"name":"repair"');
	});

	flow("a hand-written failure isn't offered repair", async ({ project }) => {
		await project.scriptModel({
			turns: [
				...solveEveryStep,
				{ tool: "fail", input: { reason: "Payment is broken." } },
			],
		});
		await project.run();

		await project.run({ shop: "broken-payment" });

		const diagnosis = (await project.modelCalls()).at(-1);
		expect(diagnosis).toContain("A line of the hand-written test failed");
		expect(diagnosis).not.toContain('"name":"repair"');
	});

	flow("custom prompts can't be used with an agent", async ({ project }) => {
		const run = await project.run({ generatePrompt: "Only these words." });

		expect(run.exitCode).toBe(1);
		expect(run.test(CHECKOUT_TEST).errors[0]).toContain(
			"can't be combined with use.intent.agent",
		);
	});
});
