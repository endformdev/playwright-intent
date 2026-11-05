import { expect, test } from "vitest";
import { sanitizeSegment, stepKey } from "../src/step/step-path";

test("maps a test to a literal path", () => {
	expect(
		stepKey({
			testFile: "tests/checkout/cart.spec.ts",
			titles: ["cart", "guest checkout"],
			intent: "Fill out the checkout",
		}),
	).toBe(
		"tests/checkout/cart.spec.ts/cart - guest checkout/fill out the checkout.ts",
	);
});

test("keeps placeholders readable", () => {
	expect(sanitizeSegment("sign up as {email}")).toBe("sign up as {email}");
});

test("replaces characters that aren't safe on every filesystem", () => {
	expect(sanitizeSegment('pay: now? "yes" / no')).toBe("pay- now- -yes- - no");
});

test("treats different casing as the same step", () => {
	expect(sanitizeSegment("Login")).toBe(sanitizeSegment("login"));
});

test("normalizes equivalent Unicode forms", () => {
	expect(sanitizeSegment("köp")).toBe(sanitizeSegment("köp"));
});

test("cuts long names without splitting a character", () => {
	const name = sanitizeSegment("ö".repeat(200));
	expect(Buffer.byteLength(name)).toBeLessThanOrEqual(150);
	expect(name).toBe("ö".repeat(75));
});

test("avoids names that Windows reserves or strips", () => {
	expect(sanitizeSegment("aux")).toBe("_aux");
	expect(sanitizeSegment("trailing dots...")).toBe("trailing dots");
	expect(sanitizeSegment("...")).toBe("_");
});

test("can't escape the .intent folder", () => {
	expect(
		stepKey({
			testFile: "../tests/a.spec.ts",
			titles: ["t"],
			intent: "go",
		}),
	).toBe("__/tests/a.spec.ts/t/go.ts");
});
