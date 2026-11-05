import { test } from "./test";

test("should successfully invite a team member and complete signup process", async ({
	page,
	ai,
}) => {
	const email = `testuser${Date.now()}@example.com`;
	await page.goto("/dashboard");

	await ai.do("invite {email} to the team as a member", { email });
	await ai.do("sign out");
});
