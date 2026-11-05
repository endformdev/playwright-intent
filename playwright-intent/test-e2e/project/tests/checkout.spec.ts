import { expect, test } from "./fixtures";

test.describe("checkout", () => {
	test("guest buys a shirt", async ({ page, ai }) => {
		await page.goto("/");

		await ai.do("add the blue shirt to the cart");
		await ai.do("go to checkout");
		await ai.do("pay as {email}", { email: "guest@example.com" });

		await expect(
			page.getByRole("heading", { name: "Thank you" }),
		).toBeVisible();
	});
});
