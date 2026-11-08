import { expect, flow } from "../harness/flow";
import {
	CHECKOUT_TEST,
	CODE,
	checkoutScript,
	failed,
	INTENT,
	solvedButDirty,
} from "../harness/shop-steps";

const CHECKOUT_FOLDER = "tests/checkout.spec.ts/checkout - guest buys a shirt";

flow.describe("generating steps", () => {
	flow(
		"a miss generates each step and the test continues",
		async ({ project }) => {
			await project.scriptAgent(checkoutScript());

			const run = await project.run();

			expect(run.exitCode).toBe(0);
			expect(run.test(CHECKOUT_TEST).attempts).toEqual(["passed"]);
			expect(await project.stepFiles()).toEqual([
				`${CHECKOUT_FOLDER}/add the blue shirt to the cart.ts`,
				`${CHECKOUT_FOLDER}/go to checkout.ts`,
				`${CHECKOUT_FOLDER}/pay as {email}.ts`,
			]);
		},
	);

	flow("exploration never reaches the step file", async ({ project }) => {
		const script = checkoutScript();
		script.generate[INTENT.add] = [
			{
				explore: ['console.log("looking around");', CODE.add],
				outcome: { status: "solved", code: CODE.add, page: "ready" },
			},
		];
		await project.scriptAgent(script);

		await project.run();

		const [call] = await project.agentCalls();
		expect(call?.logs).toEqual(["looking around"]);
		expect(
			await project.readStep(`${CHECKOUT_FOLDER}/${INTENT.add}.ts`),
		).not.toContain("looking around");
	});

	flow(
		"the agent gets the test file and the line of each step",
		async ({ project }) => {
			await project.scriptAgent(checkoutScript());

			await project.run();

			const calls = await project.agentCalls();
			expect(calls.map((call) => call.task.testFile.line)).toEqual([7, 8, 9]);
			const testFile = calls[0]?.task.testFile;
			expect(testFile?.path).toBe("tests/checkout.spec.ts");
			expect(testFile?.source).toContain('name: "Thank you"');
		},
	);

	flow(
		"a step in a helper file points at the helper's call in the test",
		async ({ project }) => {
			await project.scriptAgent(checkoutScript());
			await project.replaceInFile(
				"tests/fixtures.ts",
				'export { expect } from "playwright-intent";',
				`export { expect } from "playwright-intent";
export const goToCheckout = (ai: { do(intent: string): Promise<void> }) =>
	ai.do("go to checkout");`,
			);
			await project.replaceInFile(
				"tests/checkout.spec.ts",
				'await ai.do("go to checkout");',
				"await goToCheckout(ai);",
			);
			await project.replaceInFile(
				"tests/checkout.spec.ts",
				'import { expect, test } from "./fixtures";',
				'import { expect, goToCheckout, test } from "./fixtures";',
			);

			await project.run();

			const calls = await project.agentCalls();
			const checkout = calls.find((call) => call.intent === INTENT.checkout);
			expect(checkout?.task.testFile.line).toBe(8);
		},
	);

	flow("the agent gets variable names, not values", async ({ project }) => {
		await project.scriptAgent(checkoutScript());
		await project.replaceInFile(
			"tests/checkout.spec.ts",
			'{ email: "guest@example.com" }',
			'{ email: ["guest", "example.com"].join("@") }',
		);

		await project.run();

		const calls = await project.agentCalls();
		const pay = calls.find((call) => call.intent === INTENT.pay);
		expect(pay?.task.variableNames).toEqual(["email"]);
		expect(JSON.stringify(calls)).not.toContain("guest@example.com");
	});

	flow(
		"exploring has its own timeout, and the test keeps its own",
		async ({ project }) => {
			const script = checkoutScript();
			script.generate[INTENT.pay] = [
				{
					explore: [
						`const start = Date.now();
await page.getByRole("button", { name: "Missing" }).click().catch(() => {});
console.log(Date.now() - start);`,
						CODE.pay,
					],
					outcome: { status: "solved", code: CODE.pay, page: "ready" },
				},
			];
			await project.scriptAgent(script);
			await project.replaceInFile(
				"tests/checkout.spec.ts",
				'await ai.do("pay as {email}", { email: "guest@example.com" });',
				`await ai.do("pay as {email}", { email: "guest@example.com" });
		await page.getByRole("button", { name: "Missing" }).click();`,
			);

			const run = await project.run();

			const pay = (await project.agentCalls()).find(
				(call) => call.intent === INTENT.pay,
			);
			expect(Number(pay?.logs[0])).toBeGreaterThan(4_000);
			expect(run.test(CHECKOUT_TEST).errors[0]).toContain("Timeout 1000ms");
		},
	);

	flow("each step knows which steps came before it", async ({ project }) => {
		await project.scriptAgent(checkoutScript());

		await project.run();

		const calls = await project.agentCalls();
		expect(calls.at(-1)?.task.previousSteps).toEqual([
			INTENT.add,
			INTENT.checkout,
		]);
	});

	flow(
		"a dirty page saves the step, and a retry replays it",
		async ({ project }) => {
			const script = checkoutScript();
			script.generate[INTENT.add] = [solvedButDirty(CODE.add)];
			await project.scriptAgent(script);

			const run = await project.run({ retries: 1 });

			expect(run.exitCode).toBe(0);
			expect(run.test(CHECKOUT_TEST).outcome).toBe("flaky");
			expect(run.test(CHECKOUT_TEST).attempts).toEqual(["failed", "passed"]);

			const addCalls = (await project.agentCalls()).filter(
				(call) => call.intent === INTENT.add,
			);
			expect(addCalls).toHaveLength(1);
		},
	);

	flow(
		"a dirty page without a retry continues on the next run",
		async ({ project }) => {
			const script = checkoutScript();
			script.generate[INTENT.add] = [solvedButDirty(CODE.add)];
			await project.scriptAgent(script);

			const first = await project.run();
			expect(first.exitCode).toBe(1);
			expect(first.test(CHECKOUT_TEST).errors[0]).toContain(
				"the page can't continue from here",
			);

			const second = await project.run();
			expect(second.exitCode).toBe(0);
		},
	);

	flow(
		"a failed agent fails the test and saves nothing",
		async ({ project }) => {
			await project.scriptAgent({
				generate: { [INTENT.add]: [failed("There's no blue shirt here.")] },
			});

			const run = await project.run();

			expect(run.exitCode).toBe(1);
			expect(run.test(CHECKOUT_TEST).errors[0]).toContain(
				"There's no blue shirt here.",
			);
			expect(await project.stepFiles()).toEqual([]);
		},
	);

	flow(
		"generating without an agent explains what to configure",
		async ({ project }) => {
			const run = await project.run({ withoutAgent: true });

			expect(run.test(CHECKOUT_TEST).errors[0]).toContain("use.intent.model");
		},
	);
});
