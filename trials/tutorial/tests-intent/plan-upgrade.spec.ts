import { expect, test } from "./test";

test("should successfully upgrade from Free to Plus plan", async ({
	page,
	ai,
}) => {
	await page.goto("/dashboard");
	await expect(page.getByText("Current Plan: Free")).toBeVisible();

	await ai.do("go to the pricing page and choose the Plus plan");
	await ai.do("fill in the payment details with a test card", {});
	await ai.do("fill in a billing address in New York");
	await ai.do("complete the purchase");

	await expect(page.getByText("Current Plan: Plus")).toBeVisible();
});
