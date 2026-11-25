import fs from "node:fs/promises";
import path from "node:path";
import { expect, flow } from "../harness/flow";
import { checkoutScript, STEP_FILE } from "../harness/shop-steps";

const { version } = JSON.parse(
	await fs.readFile(
		path.join(import.meta.dirname, "..", "..", "package.json"),
		"utf8",
	),
) as { version: string };

const INSTALL = `npm install --save-dev playwright-intent@^${version}`;

/** What `npm init playwright@latest` leaves, as listed in `setups/`. */
async function createPlaywrightSuite(): Promise<Record<string, string>> {
	const setup = path.join(
		import.meta.dirname,
		"..",
		"setups",
		"create-playwright",
	);
	const read = (file: string) => fs.readFile(path.join(setup, file), "utf8");
	return {
		"package.json": JSON.stringify(
			{
				name: "my-app",
				version: "1.0.0",
				type: "commonjs",
				devDependencies: { "@playwright/test": "^1.63.0" },
			},
			null,
			2,
		),
		".gitignore": await read("gitignore.txt"),
		"playwright.config.ts": await read("playwright.config.ts.txt"),
		"tests/example.spec.ts": await read("tests/example.spec.ts.txt"),
	};
}

const ESM_PACKAGE = JSON.stringify({
	name: "shop-tests",
	type: "module",
	devDependencies: { "@playwright/test": "^1.63.0" },
});

/** A config like most suites have, with the shop as its base URL. */
const SHOP_CONFIG = `import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests",
	use: { baseURL: "http://shop.test" },
});
`;

/** The checkout test, written against a `test` that has `ai`. */
function checkoutSpec(from: string, email = `"guest@example.com"`): string {
	return `import { expect, test } from "${from}";

test.describe("checkout", () => {
	test("guest buys a shirt", async ({ page, ai${email === "email" ? ", email" : ""} }) => {
		await page.goto("/");
		await ai.do("add the blue shirt to the cart");
		await ai.do("go to checkout");
		await ai.do("pay as {email}", { email${email === "email" ? "" : `: ${email}`} });
		await expect(page.getByRole("heading", { name: "Thank you" })).toBeVisible();
	});
});
`;
}

const SHOP_FIXTURE = `import { test as base } from "@playwright/test";
import { installShop } from "../shop/app";

export { expect } from "@playwright/test";

export const test = base.extend<{ shop: void }>({
	shop: [
		async ({ page }, use) => {
			await installShop(page);
			await use();
		},
		{ auto: true },
	],
});
`;

/** A test in another package, which doesn't depend on playwright-intent. */
const OTHER_PACKAGE_SPEC = `import { expect, test } from "@playwright/test";

test("renders", async ({ page }) => {
	await expect(page).toHaveTitle("");
});
`;

flow.describe("init", () => {
	flow(
		"sets up a suite from npm init playwright, and a test then generates and replays",
		async ({ createWorkspace }) => {
			const workspace = await createWorkspace(await createPlaywrightSuite());

			const result = await workspace.intent("init");

			expect(result.exitCode, result.stderr).toBe(0);
			expect(await workspace.npmCalls()).toEqual([INSTALL]);
			const config = await workspace.read("playwright.config.ts");
			expect(config).toContain(
				"import type { IntentOptions, IntentUseOptions } from 'playwright-intent';",
			);
			expect(config).toContain(
				"const envFile = path.join(__dirname, '.env');\nif (fs.existsSync(envFile)) process.loadEnvFile(envFile);",
			);
			expect(config).toContain(
				"export default defineConfig<IntentUseOptions>({",
			);
			expect(config).toContain(
				"reporter: [['html'], ['playwright-intent/reporter', intent]],",
			);
			expect(config).toContain("  use: {\n    intent,\n");
			expect(await workspace.read("tests/example.spec.ts")).toContain(
				"import { test, expect } from 'playwright-intent';",
			);
			expect(await workspace.read(".gitignore")).toMatch(/^\.env$/m);
			expect(result.stdout).toContain(
				[
					"Set up playwright-intent in playwright.config.ts.",
					"",
					"Changed",
					"  playwright.config.ts   intent options, reporter, .env loading",
					"  tests/example.spec.ts  imports test from playwright-intent",
					"  .gitignore             ignores .env",
					"",
					`Installed playwright-intent@^${version}.`,
					"",
					"Left for you",
					"  1. Add AI_GATEWAY_API_KEY to .env, or set it in your environment. Get a key at https://vercel.com/ai-gateway.",
				].join("\n"),
			);

			const again = await workspace.intent("init");

			expect(again.exitCode, again.stderr).toBe(0);
			expect(again.stdout).toContain(
				"playwright-intent is already set up in playwright.config.ts. Nothing to change.",
			);
			expect(await workspace.npmCalls()).toEqual([INSTALL]);

			await workspace.addShop();
			await workspace.write(
				"tests/checkout.spec.ts",
				`import { installShop } from "../shop/app";\n${checkoutSpec(
					"playwright-intent",
				)
					.replace(
						'await page.goto("/")',
						'await page.goto("http://shop.test/")',
					)
					.replace(
						'test.describe("checkout", () => {',
						'test.beforeEach(async ({ page }) => installShop(page));\n\ntest.describe("checkout", () => {',
					)}`,
			);
			await workspace.useScriptedAgent(checkoutScript());

			const generated = await workspace.playwright(
				"--project=chromium",
				"tests/checkout.spec.ts",
			);
			const replayed = await workspace.playwright(
				"--project=chromium",
				"tests/checkout.spec.ts",
			);

			expect(generated.exitCode, generated.stdout).toBe(0);
			expect(await workspace.stepFiles()).toEqual(
				Object.values(STEP_FILE).sort(),
			);
			expect(replayed.exitCode, replayed.stdout).toBe(0);
		},
	);

	flow(
		"gives a fixtures file the ai fixture, and leaves the tests that import it, and other packages, alone",
		async ({ createWorkspace }) => {
			const spec = checkoutSpec("./fixtures");
			const workspace = await createWorkspace({
				"package.json": ESM_PACKAGE,
				"playwright.config.ts": SHOP_CONFIG,
				"tests/fixtures.ts": SHOP_FIXTURE,
				"tests/checkout.spec.ts": spec,
				"packages/ui/package.json": JSON.stringify({ name: "ui" }),
				"packages/ui/tests/button.spec.ts": OTHER_PACKAGE_SPEC,
				".vscode/extensions.json":
					'{\n\t// Shared with the team\n\t"recommendations": ["dbaeumer.vscode-eslint"]\n}\n',
			});
			await workspace.addShop();

			const result = await workspace.intent("init");

			expect(result.exitCode, result.stderr).toBe(0);
			expect(await workspace.read("tests/fixtures.ts")).toBe(
				SHOP_FIXTURE.replace(
					'import { test as base } from "@playwright/test";',
					'import { test as base } from "playwright-intent";',
				),
			);
			expect(await workspace.read("tests/checkout.spec.ts")).toBe(spec);
			expect(await workspace.read("packages/ui/tests/button.spec.ts")).toBe(
				OTHER_PACKAGE_SPEC,
			);
			expect(result.stdout).toContain(
				'To suggest the VS Code extension to your team, add "endform.playwright-intent-vscode" to the recommendations in .vscode/extensions.json.',
			);
			expect(await workspace.read("playwright.config.ts")).toContain(
				'const envFile = path.join(import.meta.dirname, ".env");',
			);

			await workspace.useScriptedAgent(checkoutScript());
			const run = await workspace.playwright();

			expect(run.exitCode, run.stdout).toBe(0);
			expect(await workspace.stepFiles()).toEqual(
				Object.values(STEP_FILE).sort(),
			);
		},
	);

	flow(
		"gives layered and merged fixtures the ai fixture once",
		async ({ createWorkspace }) => {
			const account = `import { test as base } from "./user";

export const test = base.extend<{ greeting: string }>({
	greeting: async ({ email }, use) => use(\`Hi \${email}\`),
});
`;
			const merged = `import { mergeTests } from "@playwright/test";
import { test as accountTest } from "./account";
import { test as shopTest } from "./shop";

export { expect } from "@playwright/test";
export const test = mergeTests(shopTest, accountTest);
`;
			const workspace = await createWorkspace({
				"package.json": ESM_PACKAGE,
				"playwright.config.ts": SHOP_CONFIG,
				"tests/fixtures/shop.ts": SHOP_FIXTURE.replace(
					"../shop/app",
					"../../shop/app",
				),
				"tests/fixtures/user.ts": `import { test as base } from "@playwright/test";

export const test = base.extend<{ email: string }>({
	email: "guest@example.com",
});
`,
				"tests/fixtures/account.ts": account,
				"tests/fixtures/index.ts": merged,
				"tests/checkout.spec.ts": checkoutSpec("./fixtures", "email"),
			});
			await workspace.addShop();

			const result = await workspace.intent("init");

			expect(result.exitCode, result.stderr).toBe(0);
			for (const file of ["tests/fixtures/shop.ts", "tests/fixtures/user.ts"]) {
				expect(await workspace.read(file)).toContain(
					'import { test as base } from "playwright-intent";',
				);
			}
			expect(await workspace.read("tests/fixtures/account.ts")).toBe(account);
			expect(await workspace.read("tests/fixtures/index.ts")).toBe(merged);

			await workspace.useScriptedAgent(checkoutScript());
			const run = await workspace.playwright();

			expect(run.exitCode, run.stdout).toBe(0);
			expect(await workspace.stepFiles()).toEqual(
				Object.values(STEP_FILE).sort(),
			);
		},
	);

	flow(
		"stops before writing anything when a fixture is already called ai",
		async ({ createWorkspace }) => {
			const workspace = await createWorkspace({
				"package.json": ESM_PACKAGE,
				"playwright.config.ts": SHOP_CONFIG,
				"tests/fixtures.ts": `import { test as base } from "@playwright/test";

export const test = base.extend<{ ai: string }>({
	ai: async ({}, use) => {
		await use("our own assistant");
	},
});
`,
			});
			const before = await workspace.snapshot();

			const result = await workspace.intent("init");

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe(
				"These fixtures already use names that playwright-intent adds:\n\n  tests/fixtures.ts:4  ai\n\nRename them, then run this again. Nothing was changed.\n",
			);
			expect(await workspace.snapshot()).toEqual(before);
			expect(await workspace.npmCalls()).toEqual([]);
		},
	);

	flow(
		"leaves a reporter it can't edit to the user, and checks it on the next run",
		async ({ createWorkspace }) => {
			const workspace = await createWorkspace({
				"package.json": ESM_PACKAGE,
				"playwright.config.ts": `import { defineConfig } from "@playwright/test";

export default defineConfig({
	reporter: process.env.CI ? "github" : "list",
});
`,
				"tests/example.spec.ts": `import { test } from "@playwright/test";\n`,
			});

			const result = await workspace.intent("init");

			expect(result.exitCode, result.stderr).toBe(0);
			expect(result.stdout).toContain(
				[
					"Left for you",
					"  1. Add the intent reporter to reporter in playwright.config.ts, next to your own:",
					"",
					'       ["playwright-intent/reporter", intent],',
				].join("\n"),
			);

			await workspace.replaceInFile(
				"playwright.config.ts",
				'reporter: process.env.CI ? "github" : "list",',
				'reporter: [[process.env.CI ? "github" : "list"], ["playwright-intent/reporter", intent]],',
			);
			const again = await workspace.intent("init");

			expect(again.exitCode, again.stderr).toBe(0);
			expect(again.stdout).toContain(
				"playwright-intent is already set up in playwright.config.ts. Nothing to change.",
			);
			expect(again.stdout).not.toContain("reporter");
		},
	);

	flow(
		"asks which config to set up without prompting, then sets up the one named",
		async ({ createWorkspace }) => {
			const workspace = await createWorkspace({
				"apps/admin/package.json": ESM_PACKAGE,
				"apps/admin/playwright.config.ts": SHOP_CONFIG,
				"apps/web/package.json": ESM_PACKAGE,
				"apps/web/playwright.config.ts": SHOP_CONFIG,
			});
			const before = await workspace.snapshot();

			const result = await workspace.intent("init");

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe(
				[
					"There are 2 Playwright configs here. Run this again for the one to set up:",
					"",
					"  npx playwright-intent init --config apps/admin/playwright.config.ts",
					"  npx playwright-intent init --config apps/web/playwright.config.ts",
					"",
				].join("\n"),
			);
			expect(await workspace.snapshot()).toEqual(before);

			const chosen = await workspace.intent(
				"init",
				"--config",
				"apps/web/playwright.config.ts",
			);

			expect(chosen.exitCode, chosen.stderr).toBe(0);
			expect(await workspace.npmCalls()).toEqual([`apps/web: ${INSTALL}`]);
			expect(await workspace.read("apps/admin/playwright.config.ts")).toBe(
				SHOP_CONFIG,
			);
			expect(await workspace.read("apps/web/playwright.config.ts")).toContain(
				'["playwright-intent/reporter", intent]',
			);
		},
	);

	flow(
		"npm init playwright-intent does the same as playwright-intent init",
		async ({ createWorkspace }) => {
			const viaInit = await createWorkspace(await createPlaywrightSuite());
			const viaCreate = await createWorkspace(await createPlaywrightSuite());

			const init = await viaInit.intent("init", "--dry-run");
			const create = await viaCreate.createIntent("--dry-run");

			expect(create.exitCode, create.stderr).toBe(0);
			expect(create.stdout).toBe(init.stdout);
		},
	);

	flow(
		"a dry run lists the changes and writes nothing",
		async ({ createWorkspace }) => {
			const workspace = await createWorkspace(await createPlaywrightSuite());
			const before = await workspace.snapshot();

			const result = await workspace.intent("init", "--dry-run");

			expect(result.exitCode, result.stderr).toBe(0);
			expect(result.stdout).toContain(
				[
					"Would change",
					"  playwright.config.ts   intent options, reporter, .env loading",
					"  tests/example.spec.ts  imports test from playwright-intent",
					"  .gitignore             ignores .env",
					"",
					`Would install with ${INSTALL}`,
				].join("\n"),
			);
			expect(await workspace.snapshot()).toEqual(before);
			expect(await workspace.npmCalls()).toEqual([]);
		},
	);

	flow(
		"leaves a test package that builds on Playwright to the user",
		async ({ createWorkspace }) => {
			const workspace = await createWorkspace({
				"package.json": ESM_PACKAGE,
				"playwright.config.ts": SHOP_CONFIG,
				"tests/checkout.spec.ts": checkoutSpec("@acme/e2e"),
				"node_modules/@acme/e2e/package.json": JSON.stringify({
					name: "@acme/e2e",
					type: "module",
					exports: "./index.js",
					peerDependencies: { "@playwright/test": "*" },
				}),
				"node_modules/@acme/e2e/index.js":
					'export { test, expect } from "@playwright/test";\n',
			});

			const result = await workspace.intent("init");

			expect(result.exitCode, result.stderr).toBe(0);
			expect(result.stdout).toContain(
				[
					"  1. These files take test from @acme/e2e, which builds on @playwright/test:",
					"",
					"       tests/checkout.spec.ts",
					"",
					`     Switch @acme/e2e's own import of test to "playwright-intent", or extend it where you import it:`,
				].join("\n"),
			);
			expect(await workspace.read("node_modules/@acme/e2e/index.js")).toBe(
				'export { test, expect } from "@playwright/test";\n',
			);
		},
	);
	flow(
		"leaves the config and imports to the user when Playwright's parser can't be loaded",
		async ({ createWorkspace }) => {
			// A Playwright that doesn't export the copy of Babel it parses with.
			const workspace = await createWorkspace({
				"package.json": ESM_PACKAGE,
				"playwright.config.ts": SHOP_CONFIG,
				"tests/checkout.spec.ts": checkoutSpec("@playwright/test"),
				"node_modules/@playwright/test/package.json": JSON.stringify({
					name: "@playwright/test",
					version: "1.63.0",
					exports: { "./package.json": "./package.json" },
				}),
				"node_modules/playwright/package.json": JSON.stringify({
					name: "playwright",
					version: "1.63.0",
					exports: { "./package.json": "./package.json" },
				}),
			});

			const result = await workspace.intent("init");

			expect(result.exitCode, result.stderr).toBe(0);
			expect(await workspace.read("playwright.config.ts")).toBe(SHOP_CONFIG);
			expect(await workspace.read("tests/checkout.spec.ts")).toBe(
				checkoutSpec("@playwright/test"),
			);
			expect(await workspace.npmCalls()).toEqual([INSTALL]);
			expect(result.stdout).toContain(
				"  1. Playwright's parser couldn't be loaded, so playwright.config.ts is left for you. Add the intent options:",
			);
			expect(result.stdout).toContain(
				[
					'  2. Import test from "playwright-intent" instead of "@playwright/test" in:',
					"",
					"       tests/checkout.spec.ts",
				].join("\n"),
			);
		},
	);
});
