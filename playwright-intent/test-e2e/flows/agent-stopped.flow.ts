import { expect, flow } from "../harness/flow";
import type { Project } from "../harness/project";
import { CHECKOUT_TEST, CODE, INTENT } from "../harness/shop-steps";
import type { ModelScript, ModelTurn } from "../project/scripted-model";
import type { ShopVariant } from "../project/shop/app";

const solveEveryStep: ModelTurn[] = [CODE.add, CODE.checkout, CODE.pay].flatMap(
	(code) => [
		{ tool: "run", input: { code } },
		{ tool: "finish", input: { code, page: "ready" } },
	],
);

const look: ModelTurn = { tool: "look", input: {} };

const CAUSES: (Omit<ModelScript, "turns"> & {
	name: string;
	turns: ModelScript["turns"];
	says: string;
})[] = [
	{
		name: "running out of turns",
		turns: [look, look],
		limits: { maxTurns: 2 },
		says: "didn't finish within 2 turns",
	},
	{
		name: "a model that never responds",
		turns: [{ hangs: true }],
		limits: { timeoutMs: 2_000 },
		says: "didn't finish within 2 seconds",
	},
	{
		name: "exploring code that never returns",
		turns: [{ tool: "run", input: { code: "await new Promise(() => {});" } }],
		limits: { timeoutMs: 2_000 },
		says: "didn't finish within 2 seconds",
	},
	{
		name: "a provider error",
		turns: [{ throws: "429 rate limited" }],
		says: "The model call failed: 429 rate limited",
	},
];

const DIAGNOSED_FAILURES: {
	name: string;
	shop: ShopVariant;
	ownError: string;
}[] = [
	{
		name: "a saved step",
		shop: "renamed-add-link",
		ownError: "Timeout 1000ms",
	},
	{
		name: "a hand-written line",
		shop: "broken-payment",
		ownError: "toBeVisible",
	},
];

async function stepContents(project: Project) {
	const files = await project.stepFiles();
	return Promise.all(
		files.map(async (file) => [file, await project.readStep(file)]),
	);
}

/**
 * Hitting a limit or a model error tells us nothing about the app, so it must
 * fail the test without moving a step or starting a diagnosis.
 */
flow.describe("an agent that never answers", () => {
	for (const { name, says, ...script } of CAUSES) {
		flow(`${name} while generating changes nothing`, async ({ project }) => {
			await project.scriptModel({
				...script,
				turns: [...solveEveryStep, ...script.turns],
			});
			await project.run({ mode: "missing" });
			const before = await stepContents(project);
			await project.replaceInFile(
				"tests/checkout.spec.ts",
				`await ai.do("${INTENT.checkout}");`,
				'await ai.do("open the checkout");',
			);

			const run = await project.run({ mode: "changed" });

			expect(run.exitCode).toBe(1);
			expect(run.test(CHECKOUT_TEST).errors[0]).toContain(says);
			expect(await project.modelCalls()).toHaveLength(
				solveEveryStep.length + script.turns.length,
			);
			expect(await stepContents(project)).toEqual(before);
		});

		for (const { name: failure, shop, ownError } of DIAGNOSED_FAILURES) {
			flow(
				`${name} while diagnosing ${failure} keeps the test's error`,
				async ({ project }) => {
					await project.scriptModel({
						...script,
						turns: [...solveEveryStep, ...script.turns],
					});
					await project.run({ mode: "missing" });
					const before = await stepContents(project);

					const run = await project.run({ mode: "changed", shop });

					const test = run.test(CHECKOUT_TEST);
					expect(run.exitCode).toBe(1);
					expect(test.errors[0]).toContain(ownError);
					expect(test.errors[0]).not.toContain(says);
					expect(test.notes).toHaveLength(1);
					expect(test.notes[0]).toContain(says);
					expect(await stepContents(project)).toEqual(before);
				},
			);
		}
	}
});
