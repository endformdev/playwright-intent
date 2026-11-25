import { expect, test } from "vitest";
import { loadParser, type Parse } from "../src/cli/source";
import { scanFile } from "../src/cli/test-imports";

const parse: Parse =
	loadParser(import.meta.dirname) ??
	(() => {
		throw new Error("Playwright's parser didn't load.");
	})();

function scanCode(code: string, file: string) {
	return scanFile(code, file, parse);
}

function rewrite(code: string, file = "tests/a.spec.ts"): string {
	return scanCode(code, file).after;
}

test("an import of test moves to playwright-intent, keeping its quotes", () => {
	expect(rewrite(`import { test, expect } from '@playwright/test';\n`)).toBe(
		`import { test, expect } from 'playwright-intent';\n`,
	);
	expect(rewrite(`import { test as base } from "@playwright/test";\n`)).toBe(
		`import { test as base } from "playwright-intent";\n`,
	);
});

test("default and namespace imports move too", () => {
	expect(rewrite(`import test from "@playwright/test";\n`)).toBe(
		`import test from "playwright-intent";\n`,
	);
	expect(rewrite(`import * as pw from "@playwright/test";\n`)).toBe(
		`import * as pw from "playwright-intent";\n`,
	);
});

test("imports of only expect or types stay with Playwright", () => {
	const code = `import { expect, mergeTests } from "@playwright/test";
import type { Page } from "@playwright/test";
import { type TestInfo } from "@playwright/test";
`;
	expect(rewrite(code)).toBe(code);
});

test("re-exports of test move, and re-exports of expect stay", () => {
	expect(rewrite(`export { test, expect } from "@playwright/test";\n`)).toBe(
		`export { test, expect } from "playwright-intent";\n`,
	);
	expect(rewrite(`export * from "@playwright/test";\n`)).toBe(
		`export * from "playwright-intent";\n`,
	);
	const expectOnly = `export { expect } from "@playwright/test";\n`;
	expect(rewrite(expectOnly)).toBe(expectOnly);
});

test("CommonJS requires of test move", () => {
	expect(
		rewrite(
			`const { test, expect } = require("@playwright/test");\n`,
			"a.spec.js",
		),
	).toBe(`const { test, expect } = require("playwright-intent");\n`);
	expect(
		rewrite(`const base = require("@playwright/test").test;\n`, "a.spec.js"),
	).toBe(`const base = require("playwright-intent").test;\n`);
	expect(
		rewrite(
			`const test = require("@playwright/test");\ntest("works", async () => {});\n`,
			"a.spec.js",
		),
	).toBe(
		`const test = require("playwright-intent").test;\ntest("works", async () => {});\n`,
	);
	expect(
		rewrite(
			`const pw = require("@playwright/test");\npw.test("works", async () => {});\n`,
			"a.spec.js",
		),
	).toBe(
		`const pw = require("playwright-intent");\npw.test("works", async () => {});\n`,
	);
	const expectOnly = `const { expect } = require("@playwright/test");\n`;
	expect(rewrite(expectOnly, "a.spec.js")).toBe(expectOnly);
});

test("component tests and other runners are left alone", () => {
	const component = `import { test } from "@playwright/experimental-ct-react";\n`;
	const scan = scanCode(component, "a.spec.tsx");
	expect(scan.after).toBe(component);
	expect(scan.componentTests).toBe(true);

	const vitest = `import { test } from "vitest";\n`;
	expect(rewrite(vitest)).toBe(vitest);
});

test("a fixture or option called ai or intent is a conflict", () => {
	const scan = scanCode(
		`import { test as base } from "@playwright/test";

export const test = base.extend({
	ai: async ({ page }, use) => use(page),
	intent: ["mine", { option: true }],
	other: async ({}, use) => use(1),
});
`,
		"fixtures.ts",
	);
	expect(scan.conflicts).toEqual([
		{ file: "fixtures.ts", line: 4, name: "ai" },
		{ file: "fixtures.ts", line: 5, name: "intent" },
	]);

	const staticValue = scanCode(
		`import { test as base } from "@playwright/test";

export const test = base.extend<{ ai: string }>({ ai: "mine" });
`,
		"static.ts",
	);
	expect(staticValue.conflicts).toEqual([
		{ file: "static.ts", line: 3, name: "ai" },
	]);
});

test("an ai property that isn't a Playwright fixture isn't a conflict", () => {
	const schema = scanCode(
		`const schema = z.object({}).extend({ ai: z.string() });\n`,
		"schema.ts",
	);
	expect(schema.conflicts).toEqual([]);

	const vitest = scanCode(
		`import { test as base } from "vitest";

const test = base.extend({
	ai: async ({}, use) => use("mock"),
});
`,
		"ai.test.ts",
	);
	expect(vitest.conflicts).toEqual([]);
});

test("test from another package is reported, for the caller to check", () => {
	const scan = scanCode(`import { test } from "@acme/e2e";\n`, "a.spec.ts");
	expect(scan.testSources).toEqual(["@acme/e2e"]);
});
