import { expect, test } from "vitest";
import { findIntentCall } from "../src/intent-call";

/** Finds the call at the first `|`, which is removed from the source. */
function callAt(source: string) {
	const offset = source.indexOf("|");
	return findIntentCall("cart.spec.ts", source.replace("|", ""), offset);
}

test("reads the titles of nested describes and the test", () => {
	const call = callAt(`
		test.describe("cart", () => {
			test.describe.serial("guest", () => {
				test("checkout", async ({ ai }) => {
					await ai.do("add the |{item}", { item: "shirt" });
				});
			});
		});`);

	expect(call).toMatchObject({
		intent: "add the {item}",
		titles: ["cart", "guest", "checkout"],
		onIntent: true,
	});
});

test("finds the call from its do", () => {
	expect(
		callAt(`test("checkout", async ({ ai }) => { await ai.d|o("pay"); });`),
	).toMatchObject({ intent: "pay", titles: ["checkout"], onIntent: false });
});

test("finds a call on another page", () => {
	expect(
		callAt(
			`test("checkout", async ({ ai, page }) => { await ai(page).do("p|ay"); });`,
		),
	).toMatchObject({ intent: "pay", titles: ["checkout"] });
});

test("skips steps, anonymous describes and test modifiers like Playwright does", () => {
	const call = callAt(`
		test.describe(() => {
			test.only("checkout", { tag: "@cart" }, async ({ ai }) => {
				await test.step("pay", async () => {
					await ai.do("p|ay");
				});
			});
		});`);

	expect(call?.titles).toEqual(["checkout"]);
});

test("has no titles when a run decides them", () => {
	const inLoop = callAt(`
		for (const size of ["s", "m"]) {
			test(\`buy \${size}\`, async ({ ai }) => { await ai.do("p|ay"); });
		}`);
	const inHook = callAt(`
		test.beforeEach(async ({ ai }) => { await ai.do("p|ay"); });
		test("checkout", async () => {});`);
	const inHelper = callAt(`
		export async function pay(ai) { await ai.do("p|ay"); }`);

	expect(inLoop?.titles).toBeNull();
	expect(inHook?.titles).toBeNull();
	expect(inHelper?.titles).toBeNull();
});

test("ignores anything that isn't an intent", () => {
	expect(callAt(`ai.do(int|ent);`)).toBeUndefined();
	expect(callAt(`ai.run("p|ay");`)).toBeUndefined();
	expect(callAt(`a|i.do("pay");`)).toBeUndefined();
	expect(callAt(`ai.do("pay", { item: "sh|irt" });`)).toBeUndefined();
});
