import { expect, test } from "vitest";
import { slugify, stepKey } from "../src/step/step-path";

test("maps a test to a literal path", () => {
	expect(
		stepKey({
			testFile: "tests/checkout/cart.spec.ts",
			titles: ["cart", "guest checkout"],
			intent: "Fill out the checkout",
		}),
	).toBe(
		"tests/checkout/cart.spec.ts/cart--guest-checkout/fill-out-the-checkout.ts",
	);
});

test("separates titles unambiguously", () => {
	const nested = stepKey({
		testFile: "a.spec.ts",
		titles: ["cart", "guest checkout"],
		intent: "go",
	});
	const flat = stepKey({
		testFile: "a.spec.ts",
		titles: ["cart - guest checkout"],
		intent: "go",
	});
	expect(nested).not.toBe(flat);
	expect(flat).toBe("a.spec.ts/cart-guest-checkout/go.ts");
});

test("never contains spaces", () => {
	expect(
		stepKey({
			testFile: "my tests\\sign up.spec.ts",
			titles: ["sign up"],
			intent: "fill  in\tthe form",
		}),
	).toBe("my-tests/sign-up.spec.ts/sign-up/fill-in-the-form.ts");
});

test("keeps the name of a placeholder", () => {
	expect(slugify("sign up as {email}")).toBe("sign-up-as-email");
});

test("drops apostrophes inside words", () => {
	expect(slugify("don't click the user’s name")).toBe(
		"dont-click-the-users-name",
	);
});

test("replaces characters that need quoting in shells, globs or URLs", () => {
	expect(slugify('pay: now? "yes" / no')).toBe("pay-now-yes-no");
	expect(
		slugify("open [menu] & pick #2 (100%) $ ! ~ @ = + , ; ` ^ * | < >"),
	).toBe("open-menu-pick-2-100");
});

test("keeps letters from every script", () => {
	expect(slugify("Köp en tröja")).toBe("köp-en-tröja");
	expect(slugify("カートに追加")).toBe("カートに追加");
});

test("treats different casing as the same step", () => {
	expect(slugify("Login")).toBe(slugify("login"));
});

test("normalizes equivalent Unicode forms", () => {
	expect(slugify("köp")).toBe(slugify("köp"));
});

test("cuts long names without splitting a character", () => {
	expect(slugify("a".repeat(100))).toBe("a".repeat(64));
	const name = slugify("ö".repeat(200));
	expect(Buffer.byteLength(name)).toBeLessThanOrEqual(150);
	expect(name).toBe("ö".repeat(64));
});

test("doesn't end a cut name on punctuation", () => {
	expect(slugify(`${"a".repeat(63)} b`)).toBe("a".repeat(63));
});

test("trims punctuation that would hide a file or look like a flag", () => {
	expect(slugify(".hidden")).toBe("hidden");
	expect(slugify("-flag")).toBe("flag");
	expect(slugify("trailing dots...")).toBe("trailing-dots");
	expect(slugify("...")).toBe("_");
});

test("avoids names that Windows reserves", () => {
	expect(slugify("aux")).toBe("_aux");
	expect(slugify("con.backup")).toBe("_con.backup");
	expect(slugify("COM1")).toBe("_com1");
	expect(slugify("console")).toBe("console");
});

test("can't escape the .intent folder", () => {
	expect(
		stepKey({
			testFile: "../tests/a.spec.ts",
			titles: ["t"],
			intent: "go",
		}),
	).toBe("_/tests/a.spec.ts/t/go.ts");
});
