import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { renderStepFile } from "../../playwright-intent/src/step/step-file";
import { findSteps } from "../src/find-steps";

test("finds the step for a test's titles", () => {
	const root = project({
		"tests/cart.spec.ts/cart - checkout/add the {item}.ts":
			"await page.click('#add');\nawait page.click('#cart');",
	});

	const [step, ...others] = findSteps(path.join(root, "tests/cart.spec.ts"), {
		intent: "Add the {item}",
		titles: ["cart", "checkout"],
	});

	expect(others).toEqual([]);
	expect(step).toMatchObject({
		key: "tests/cart.spec.ts/cart - checkout/add the {item}.ts",
		code: "await page.click('#add');\nawait page.click('#cart');",
	});
	const lines = fs.readFileSync(step!.path, "utf8").split("\n");
	expect(lines[step!.codeLine]).toBe("\tawait page.click('#add');");
});

test("finds steps by intent when the titles aren't known, this file's first", () => {
	const root = project({
		"tests/cart.spec.ts/buy s/pay.ts": "s()",
		"tests/cart.spec.ts/buy m/pay.ts": "m()",
		"tests/other.spec.ts/buy/pay.ts": "other()",
	});
	const find = (testFile: string) =>
		findSteps(path.join(root, testFile), { intent: "pay", titles: null }).map(
			(step) => step.key,
		);

	expect(find("tests/cart.spec.ts")).toEqual([
		"tests/cart.spec.ts/buy m/pay.ts",
		"tests/cart.spec.ts/buy s/pay.ts",
	]);
	expect(find("tests/helpers.ts")).toHaveLength(3);
});

test("falls back to the intent when titles don't match a step", () => {
	const root = project({ "tests/cart.spec.ts/checkout/pay.ts": "pay()" });

	expect(
		findSteps(path.join(root, "tests/cart.spec.ts"), {
			intent: "pay",
			titles: ["wrapper", "checkout"],
		}).map((step) => step.key),
	).toEqual(["tests/cart.spec.ts/checkout/pay.ts"]);
});

test("finds nothing without a step or an .intent folder", () => {
	const root = project({ "tests/cart.spec.ts/checkout/pay.ts": "pay()" });
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), "no-intent-"));
	const call = { intent: "refund", titles: ["checkout"] };

	expect(findSteps(path.join(root, "tests/cart.spec.ts"), call)).toEqual([]);
	expect(findSteps(path.join(outside, "cart.spec.ts"), call)).toEqual([]);
});

/** A project folder with these steps in `.intent`. */
function project(steps: Record<string, string>): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "intent-steps-"));
	for (const [key, code] of Object.entries(steps)) {
		const file = path.join(root, ".intent", key);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, renderStepFile({ intent: "", test: "", code }));
	}
	return root;
}
