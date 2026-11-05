import { expect, test } from "vitest";
import {
	actedBeforeLine,
	parseStepCode,
	parseStepHeader,
	renderStepFile,
} from "../src/step/step-file";

test("renders a step that can be read back", () => {
	const source = renderStepFile({
		intent: 'say "hi"',
		test: "cart > guest",
		code: "await page.goto('/');\n\nawait page.reload();",
	});

	expect(source).toMatchInlineSnapshot(`
		"// intent: "say \\"hi\\""
		// test: "cart > guest"
		import type { StepContext } from "playwright-intent";

		export default async function ({ page, context, request, expect, vars }: StepContext): Promise<void> {
			await page.goto('/');

			await page.reload();
		}
		"
	`);
	expect(parseStepHeader(source)).toEqual({
		intent: 'say "hi"',
		test: "cart > guest",
	});
});

test("returns null for a file without a header", () => {
	expect(parseStepHeader("export default async function () {}")).toBeNull();
});

test("reads back the statements it rendered", () => {
	const code = 'await page.click("a");\n\nawait expect(page).toHaveURL("/");';

	expect(parseStepCode(renderStepFile({ intent: "i", test: "t", code }))).toBe(
		code,
	);
});

const FOUR_LINES = [
	"const link = page.getByRole('link');",
	"await expect(link).toBeVisible();",
	"await link.click();",
	"await expect(page).toHaveURL('/next');",
].join("\n");

test("nothing acted when only reads came before the failure", () => {
	expect(actedBeforeLine(FOUR_LINES, 6)).toBe(false);
	expect(actedBeforeLine(FOUR_LINES, 8)).toBe(false);
});

test("something acted when an action came before the failure", () => {
	expect(actedBeforeLine(FOUR_LINES, 9)).toBe(true);
});

test("a failing line with several statements counts as acting", () => {
	const code = "await a.click(); await expect(b).toBeVisible();";

	expect(actedBeforeLine(code, 6)).toBe(true);
});
