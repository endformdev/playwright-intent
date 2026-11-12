import type { ScriptedGeneration } from "../project/scripted-agent";

/** The intents in `project/tests/checkout.spec.ts`. */
export const CHECKOUT_TEST = "guest buys a shirt";

export const INTENT = {
	add: "add the blue shirt to the cart",
	checkout: "go to checkout",
	pay: "pay as {email}",
};

/** Where the checkout test's steps are saved, under `.intent`. */
export const CHECKOUT_FOLDER =
	"tests/checkout.spec.ts/checkout--guest-buys-a-shirt";

export const STEP_FILE = {
	add: `${CHECKOUT_FOLDER}/add-the-blue-shirt-to-the-cart.ts`,
	checkout: `${CHECKOUT_FOLDER}/go-to-checkout.ts`,
	pay: `${CHECKOUT_FOLDER}/pay-as-email.ts`,
};

/** Correct step code for the `baseline` shop. */
export const CODE = {
	add: `await page.getByRole("link", { name: "Add blue shirt" }).click();
await expect(page.getByRole("heading", { name: "Your cart" })).toBeVisible();`,
	checkout: `await page.getByRole("link", { name: "Checkout" }).click();
await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();`,
	pay: `await page.getByLabel("Email").fill(vars.email);
await page.getByRole("button", { name: "Pay" }).click();`,
};

/** The agent did the step on the page, and the test can carry on. */
export function solved(code: string): ScriptedGeneration {
	return {
		explore: [code],
		outcome: { status: "solved", code, page: "ready" },
	};
}

/** The agent knows the code, but left the page somewhere unusable. */
export function solvedButDirty(code: string): ScriptedGeneration {
	return {
		explore: ['await page.goto("/somewhere-else");'],
		outcome: { status: "solved", code, page: "dirty" },
	};
}

export function failed(message: string): ScriptedGeneration {
	return { outcome: { status: "failed", message } };
}

/** An agent script that generates the whole checkout test cleanly. */
export function checkoutScript() {
	return {
		generate: {
			[INTENT.add]: [solved(CODE.add)],
			[INTENT.checkout]: [solved(CODE.checkout)],
			[INTENT.pay]: [solved(CODE.pay)],
		},
	};
}
