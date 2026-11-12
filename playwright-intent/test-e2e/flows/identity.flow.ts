import { expect, flow } from "../harness/flow";
import {
	checkoutScript,
	CHECKOUT_TEST,
	CODE,
	INTENT,
	solved,
} from "../harness/shop-steps";

const IDENTITY_TESTS = { files: ["tests/identity.spec.ts"] };
const OPEN_CART = 'await page.goto("/cart");';

flow.describe("step identity", () => {
	flow("a step's path mirrors where it's called from", async ({ project }) => {
		await project.scriptAgent(checkoutScript());

		await project.run();

		const [first] = await project.stepFiles();
		expect(first).toBe(
			"tests/checkout.spec.ts/checkout--guest-buys-a-shirt/add-the-blue-shirt-to-the-cart.ts",
		);
	});

	for (const title of [
		"repeats an intent",
		"repeats an intent in different casing",
	]) {
		flow(`${title}: fails loudly`, async ({ project }) => {
			await project.scriptAgent({
				generate: { "open the cart": [solved(OPEN_CART)] },
			});

			const run = await project.run({
				...IDENTITY_TESTS,
				grep: `${title}$`,
			});

			expect(run.test(title).errors[0]).toContain("Reword one of them");
		});
	}

	flow("a placeholder without a value fails", async ({ project }) => {
		const run = await project.run({
			...IDENTITY_TESTS,
			grep: "forgets a variable",
		});

		expect(run.test("forgets a variable").errors[0]).toContain(
			"has no value for: email",
		);
		expect(await project.agentCalls()).toEqual([]);
	});

	flow("a value without a placeholder fails", async ({ project }) => {
		const run = await project.run({
			...IDENTITY_TESTS,
			grep: "passes an unused variable",
		});

		expect(run.test("passes an unused variable").errors[0]).toContain(
			"has no placeholder for: email",
		);
	});

	flow("a step file from another test fails loudly", async ({ project }) => {
		await project.scriptAgent(checkoutScript());
		await project.run();

		const key =
			"tests/checkout.spec.ts/checkout--guest-buys-a-shirt/go-to-checkout.ts";
		const source = await project.readStep(key);
		await project.writeStep(
			key,
			source.replace("checkout > guest buys a shirt", "some other test"),
		);

		const run = await project.run();

		expect(run.test(CHECKOUT_TEST).errors[0]).toContain("doesn't belong to");
	});

	flow("a long intent cut to the same name is a miss", async ({ project }) => {
		// Both intents share their first 64 characters, so they share a file. The
		// header holds the exact text, so this must regenerate, not reuse it.
		const start = `add the blue shirt ${"very ".repeat(40)}`;
		const first = `${start}quickly`;
		const second = `${start}slowly`;
		await project.scriptAgent({
			generate: {
				...checkoutScript().generate,
				[first]: [solved(CODE.add)],
				[second]: [solved(CODE.add)],
			},
		});
		await project.replaceInFile(
			"tests/checkout.spec.ts",
			`await ai.do("${INTENT.add}");`,
			`await ai.do("${first}");`,
		);
		await project.run();
		const filesBefore = await project.stepFiles();

		await project.replaceInFile("tests/checkout.spec.ts", first, second);
		const run = await project.run();

		expect(run.exitCode).toBe(0);
		expect((await project.agentCalls()).at(-1)?.intent).toBe(second);
		expect(await project.stepFiles()).toEqual(filesBefore);
	});
});
