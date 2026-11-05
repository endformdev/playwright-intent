import { expect, flow } from "../harness/flow";
import {
	checkoutScript,
	CHECKOUT_TEST,
	CODE,
	solved,
} from "../harness/shop-steps";

const IDENTITY_TESTS = { files: ["tests/identity.spec.ts"] };
const OPEN_CART = 'await page.goto("/cart");';

flow.describe("step identity", () => {
	flow("a step's path mirrors where it's called from", async ({ project }) => {
		await project.scriptAgent(checkoutScript());

		await project.run({ mode: "missing" });

		const [first] = await project.stepFiles();
		expect(first).toBe(
			"tests/checkout.spec.ts/checkout - guest buys a shirt/add the blue shirt to the cart.ts",
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
				mode: "missing",
				grep: `${title}$`,
			});

			expect(run.test(title).errors[0]).toContain("Reword one of them");
		});
	}

	flow("a placeholder without a value fails", async ({ project }) => {
		const run = await project.run({
			...IDENTITY_TESTS,
			mode: "missing",
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
			mode: "missing",
			grep: "passes an unused variable",
		});

		expect(run.test("passes an unused variable").errors[0]).toContain(
			"has no placeholder for: email",
		);
	});

	flow("a step file from another test fails loudly", async ({ project }) => {
		await project.scriptAgent(checkoutScript());
		await project.run({ mode: "missing" });

		const key =
			"tests/checkout.spec.ts/checkout - guest buys a shirt/go to checkout.ts";
		const source = await project.readStep(key);
		await project.writeStep(
			key,
			source.replace("checkout > guest buys a shirt", "some other test"),
		);

		const run = await project.run({ mode: "none" });

		expect(run.test(CHECKOUT_TEST).errors[0]).toContain("doesn't belong to");
	});

	flow.fixme(
		"a long intent cut to the same name is a miss",
		async ({ project }) => {
			// Two long intents share their first 150 bytes. The header holds the
			// exact text, so changing one must regenerate, not reuse the other.
			await project.scriptAgent({
				generate: { "open the cart": [solved(CODE.add)] },
			});
		},
	);
});
