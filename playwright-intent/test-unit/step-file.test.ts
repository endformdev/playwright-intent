import { expect, test } from "vitest";
import { parseStepHeader, renderStepFile } from "../src/step/step-file";

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
