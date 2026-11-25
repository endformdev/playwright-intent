import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_MODEL, editConfig } from "../src/cli/config-edit";
import { loadParser, type Parse } from "../src/cli/source";

const parse: Parse =
	loadParser(import.meta.dirname) ??
	(() => {
		throw new Error("Playwright's parser didn't load.");
	})();

const CREATE_PLAYWRIGHT = fs.readFileSync(
	path.join(
		import.meta.dirname,
		"../test-e2e/setups/create-playwright/playwright.config.ts.txt",
	),
	"utf8",
);

function edit(code: string, file = "playwright.config.ts", esm = true) {
	return editConfig({ code, file, parse, esm, model: DEFAULT_MODEL });
}

test("the config from npm init playwright", () => {
	const result = edit(CREATE_PLAYWRIGHT, "playwright.config.ts", false);

	expect(result.added).toEqual(["intent options", "reporter", ".env loading"]);
	expect(result.manual).toEqual([]);
	expect(result.code).toMatchInlineSnapshot(`
		"import { defineConfig, devices } from '@playwright/test';
		import type { IntentOptions, IntentUseOptions } from 'playwright-intent';
		import { allow, fileStore, refuse } from 'playwright-intent/file-store';
		import fs from 'node:fs';
		import path from 'node:path';

		/**
		 * Read environment variables from file.
		 */
		const envFile = path.join(__dirname, '.env');
		if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

		const intent = {
		  model: 'openai/gpt-6-luna',
		  store: fileStore({ updates: { local: allow(), ci: refuse() } }),
		} satisfies IntentOptions;

		/**
		 * See https://playwright.dev/docs/test-configuration.
		 */
		export default defineConfig<IntentUseOptions>({
		  testDir: './tests',
		  /* Run tests in files in parallel */
		  fullyParallel: true,
		  /* Fail the build on CI if you accidentally left test.only in the source code. */
		  forbidOnly: !!process.env.CI,
		  /* Retry on CI only */
		  retries: process.env.CI ? 2 : 0,
		  /* Opt out of parallel tests on CI. */
		  workers: process.env.CI ? 1 : undefined,
		  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
		  reporter: [['html'], ['playwright-intent/reporter', intent]],
		  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
		  use: {
		    intent,
		    /* Base URL to use in actions like \`await page.goto('')\`. */
		    // baseURL: 'http://localhost:3000',

		    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
		    trace: 'on-first-retry',
		  },

		  /* Configure projects for major browsers */
		  projects: [
		    {
		      name: 'chromium',
		      use: { ...devices['Desktop Chrome'] },
		    },

		    {
		      name: 'firefox',
		      use: { ...devices['Desktop Firefox'] },
		    },

		    {
		      name: 'webkit',
		      use: { ...devices['Desktop Safari'] },
		    },

		    /* Test against mobile viewports. */
		    // {
		    //   name: 'Mobile Chrome',
		    //   use: { ...devices['Pixel 5'] },
		    // },
		    // {
		    //   name: 'Mobile Safari',
		    //   use: { ...devices['iPhone 12'] },
		    // },

		    /* Test against branded browsers. */
		    // {
		    //   name: 'Microsoft Edge',
		    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
		    // },
		    // {
		    //   name: 'Google Chrome',
		    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
		    // },
		  ],

		  /* Run your local dev server before starting the tests */
		  // webServer: {
		  //   command: 'npm run start',
		  //   url: 'http://localhost:3000',
		  //   reuseExistingServer: !process.env.CI,
		  // },
		});
		"
	`);
});

test("a tab-indented ESM config with double quotes", () => {
	const result = edit(`import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests",
	reporter: [["list"], ["html", { open: "never" }]],
	use: { baseURL: "http://localhost:3000" },
});
`);

	expect(result.code).toMatchInlineSnapshot(`
		"import { defineConfig, devices } from "@playwright/test";
		import type { IntentOptions, IntentUseOptions } from "playwright-intent";
		import { allow, fileStore, refuse } from "playwright-intent/file-store";
		import fs from "node:fs";
		import path from "node:path";

		const envFile = path.join(import.meta.dirname, ".env");
		if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

		const intent = {
			model: "openai/gpt-6-luna",
			store: fileStore({ updates: { local: allow(), ci: refuse() } }),
		} satisfies IntentOptions;

		export default defineConfig<IntentUseOptions>({
			testDir: "./tests",
			reporter: [["list"], ["html", { open: "never" }], ["playwright-intent/reporter", intent]],
			use: { intent, baseURL: "http://localhost:3000" },
		});
		"
	`);
});

test("a config without reporter or use", () => {
	const result = edit(`import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests",
	retries: 1
});
`);

	expect(result.code).toMatchInlineSnapshot(`
		"import { defineConfig } from "@playwright/test";
		import type { IntentOptions, IntentUseOptions } from "playwright-intent";
		import { allow, fileStore, refuse } from "playwright-intent/file-store";
		import fs from "node:fs";
		import path from "node:path";

		const envFile = path.join(import.meta.dirname, ".env");
		if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

		const intent = {
			model: "openai/gpt-6-luna",
			store: fileStore({ updates: { local: allow(), ci: refuse() } }),
		} satisfies IntentOptions;

		export default defineConfig<IntentUseOptions>({
			testDir: "./tests",
			retries: 1,
			reporter: [["list"], ["playwright-intent/reporter", intent]],
			use: { intent }
		});
		"
	`);
});

test("an empty config", () => {
	expect(
		edit(
			`import { defineConfig } from '@playwright/test'\n\nexport default defineConfig({})\n`,
		).code,
	).toMatchInlineSnapshot(`
		"import { defineConfig } from '@playwright/test'
		import type { IntentOptions, IntentUseOptions } from 'playwright-intent'
		import { allow, fileStore, refuse } from 'playwright-intent/file-store'
		import fs from 'node:fs'
		import path from 'node:path'

		const envFile = path.join(import.meta.dirname, '.env')
		if (fs.existsSync(envFile)) process.loadEnvFile(envFile)

		const intent = {
			model: 'openai/gpt-6-luna',
			store: fileStore({ updates: { local: allow(), ci: refuse() } }),
		} satisfies IntentOptions

		export default defineConfig<IntentUseOptions>({
			reporter: [['list'], ['playwright-intent/reporter', intent]],
			use: { intent },
		})
		"
	`);
});

test("custom options keep their type", () => {
	const result = edit(`import { defineConfig } from "@playwright/test";
import type { TestOptions } from "./tests/fixtures";

export default defineConfig<TestOptions>({
	use: { user: "ada" },
});
`);

	expect(result.code).toContain(
		"defineConfig<TestOptions & IntentUseOptions>(",
	);
});

test("a typed config object", () => {
	const result =
		edit(`import type { PlaywrightTestConfig } from "@playwright/test";

const config: PlaywrightTestConfig = {
	use: { trace: "on" },
};

export default config;
`);

	expect(result.code).toMatchInlineSnapshot(`
		"import type { PlaywrightTestConfig } from "@playwright/test";
		import type { IntentOptions, IntentUseOptions } from "playwright-intent";
		import { allow, fileStore, refuse } from "playwright-intent/file-store";
		import fs from "node:fs";
		import path from "node:path";

		const envFile = path.join(import.meta.dirname, ".env");
		if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

		const intent = {
			model: "openai/gpt-6-luna",
			store: fileStore({ updates: { local: allow(), ci: refuse() } }),
		} satisfies IntentOptions;

		const config: PlaywrightTestConfig<IntentUseOptions> = {
			use: { intent, trace: "on" },
			reporter: [["list"], ["playwright-intent/reporter", intent]],
		};

		export default config;
		"
	`);
});

test("a CommonJS config", () => {
	const result = edit(
		`// @ts-check
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
	reporter: "dot",
});
`,
		"playwright.config.js",
		false,
	);

	expect(result.code).toMatchInlineSnapshot(`
		"// @ts-check
		const { defineConfig } = require("@playwright/test");
		const { allow, fileStore, refuse } = require("playwright-intent/file-store");
		const fs = require("node:fs");
		const path = require("node:path");

		const envFile = path.join(__dirname, ".env");
		if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

		/** @type {import("playwright-intent").IntentOptions} */
		const intent = {
			model: "openai/gpt-6-luna",
			store: fileStore({ updates: { local: allow(), ci: refuse() } }),
		};

		module.exports = defineConfig({
			reporter: [["dot"], ["playwright-intent/reporter", intent]],
			use: { intent },
		});
		"
	`);
});

test("a reporter that isn't a literal is left for the user", () => {
	const result = edit(`import { defineConfig } from "@playwright/test";

export default defineConfig({
	reporter: process.env.CI ? "github" : "list",
});
`);

	expect(result.added).toEqual(["intent options", ".env loading"]);
	expect(result.manual).toEqual([
		`Add the intent reporter to reporter in playwright.config.ts, next to your own:\n\n  ["playwright-intent/reporter", intent],`,
	]);
});

test("a config that's already set up is left alone", () => {
	const first = edit(CREATE_PLAYWRIGHT, "playwright.config.ts", false).code;
	const second = edit(first, "playwright.config.ts", false);

	expect(second.code).toBe(first);
	expect(second.added).toEqual([]);
	expect(second.manual).toEqual([]);
	expect(second.gatewayModel).toBe(DEFAULT_MODEL);
});

test("a config that already loads .env keeps its own loading", () => {
	const result = edit(`import "dotenv/config";
import { defineConfig } from "@playwright/test";

export default defineConfig({});
`);

	expect(result.added).not.toContain(".env loading");
	expect(result.code).not.toContain("loadEnvFile");
});

test("an existing intent binding gets another name", () => {
	const result = edit(`import { defineConfig } from "@playwright/test";

const intent = "something else";

export default defineConfig({ use: {} });
`);

	expect(result.code).toContain("const intentOptions = {");
	expect(result.code).toContain("use: { intent: intentOptions }");
	expect(result.code).toContain(
		'["playwright-intent/reporter", intentOptions]',
	);
});

test("an exported object that can't be found is left for the user", () => {
	const result = edit(`import { defineConfig } from "@playwright/test";

export default makeConfig();
`);

	expect(result.added).toEqual([]);
	expect(result.code).toContain("makeConfig()");
	expect(result.manual[0]).toContain("add the intent options by hand");
});
