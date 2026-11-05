import { expect, test } from "./test";

test("should change user name in general settings and verify it appears in team members list", async ({
	page,
	ai,
}) => {
	await page.goto("/dashboard");

	await ai.do("open the general settings");
	await ai.do("change my name to {name}", { name: "John Doe" });
	await ai.do("go back to the team settings");

	await expect(page.getByText("John Doe")).toBeVisible();
});
