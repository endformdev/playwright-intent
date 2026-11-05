import { test } from "./fixtures";

test("repeats an intent", async ({ page, ai }) => {
	await page.goto("/");
	await ai.do("open the cart");
	await ai.do("open the cart");
});

test("repeats an intent in different casing", async ({ page, ai }) => {
	await page.goto("/");
	await ai.do("open the cart");
	await ai.do("Open The Cart");
});

test("forgets a variable", async ({ page, ai }) => {
	await page.goto("/");
	await ai.do("pay as {email}");
});

test("passes an unused variable", async ({ page, ai }) => {
	await page.goto("/");
	await ai.do("open the cart", { email: "guest@example.com" });
});
