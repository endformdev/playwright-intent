/**
 * Everything the built-in agent's model reads.
 *
 * `defaultPrompts` is policy: what good work looks like. You can extend or
 * replace it with `use.intent.prompts`. The tools are the contract with the
 * library and can't be changed, so everything needed to use them correctly
 * belongs in their descriptions, not in the prompts.
 */
import type { JSONSchema7 } from "ai";
import type {
	DiagnoseTask,
	GenerateTask,
	Observation,
	RunResult,
} from "./agent";
import { EXPLORATION_ACTION_TIMEOUT_MS } from "./session";

export interface IntentPrompts {
	/** Instructions for writing the code of a new step. */
	generate: string;
	/** Instructions for deciding what to do after a test fails. */
	diagnose: string;
}

/** What makes code safe to save, for both new steps and repairs. */
const STEP_CODE_RULES = `- Use \`getByTestId\` when an element has a test id, because its text can change. Otherwise ask Playwright for the best locator, and use what it returns: \`return String(await page.locator("aria-ref=e6").normalize())\`.
- \`aria-ref\` values only last for one snapshot, so never put them in the final code.
- Later runs have different data. Never rely on text that only this run has, like generated names, initials, ids or dates.
- Read variables from \`vars\`, like \`vars.email\`. You don't get their values.
- Tests run against different addresses, so match URLs by path, never by host.
- Keep the code in a straight line, with no \`if\`, \`try\` or \`.catch\`. A step should fail when the app doesn't behave the same way, not adapt to it.
- Wait for conditions, never for a fixed time. Don't use \`force: true\` or \`dispatchEvent\`.
- Include only what the step needs, not your exploration. Put each statement on its own line.
- Before finishing, run every assertion in the final code exactly as you'll save it, and fix any that fail.`;

const GENERATE_PROMPT = `You turn one natural-language step of a Playwright test into code.

You work on a real browser page, which is already where the test has left it. Use \`run\` to carry out the step for real, one action at a time. Then call \`finish\` with the final code. If the step can't be done, call \`give_up\`.

The code you finish with is saved and replayed in later test runs without you, on a fresh page, so:
- Do exactly what the step says. The test file shows what happens around the step, so leave later work to it, and leave the page where the following code expects it.
- End with an \`expect\` that proves this step happened. Leave the test's own assertions to the test, and don't copy values from the test file unless the step names them.
${STEP_CODE_RULES}

If the app looks broken, or the step asks for something that isn't there, call \`give_up\` and say why. Don't work around it.`;

const DIAGNOSE_PROMPT = `A Playwright test just failed. You're on the real page it failed on, and you decide what happens next.

The test's steps are saved code, generated earlier from natural language. What you decide depends on why the test failed:

- The app works, but the saved code no longer matches it, because the UI changed. Fix it with \`repair\` if you have that tool and the failed step alone is wrong. Use \`regenerate\` if other steps need redoing too, or the page is too far along to fix from here.
- The app is wrong: a server error, an error page, missing data, or a feature that doesn't do what the test expects. Call \`fail\` and say what's broken. A test that finds a bug has done its job, so don't touch the steps.
- It looks like a one-off, like a slow response or a network error, and the page works when you check. Call \`fail\` and say so.

Look before you decide. Use \`run\` to read the page, try locators, and check whether the app really works.

Code you save with \`repair\` is replayed in later runs without you, so:
- Keep what the step checks. Update a locator or a label, but never remove or loosen an assertion to get past a failure. If the old assertion was right and the app no longer meets it, that's a \`fail\`.
${STEP_CODE_RULES}`;

/**
 * The built-in instructions, to read, build on or replace with
 * `use.intent.prompts`.
 *
 * @see https://github.com/endformdev/playwright-intent/blob/main/playwright-intent/src/agent/prompts.ts
 */
export const defaultPrompts: Readonly<IntentPrompts> = {
	generate: GENERATE_PROMPT,
	diagnose: DIAGNOSE_PROMPT,
};

const RUN_CODE_DESCRIPTION = `Playwright statements to run now, as the body of an async function with \`page\`, \`context\`, \`request\`, \`expect\` and \`vars\` in scope. Nothing is shared between runs except the browser. \`return\` a value or use \`console.log\` to see something. Actions time out after ${EXPLORATION_ACTION_TIMEOUT_MS / 1_000} seconds.`;

const SAVED_CODE_DESCRIPTION =
	"The statements to save, written the same way as for `run`.";

const PAGE_DESCRIPTION =
	"`ready` if the page is where your code would leave it. `dirty` if your code is right but the page is somewhere else, for example because exploring submitted a form twice.";

const REASON_DESCRIPTION = "Why, in one sentence.";

const REASON_SCHEMA = {
	type: "object",
	properties: {
		reason: { type: "string", description: REASON_DESCRIPTION },
	},
	required: ["reason"],
	additionalProperties: false,
} as const;

const REPAIR_SCHEMA = {
	type: "object",
	properties: {
		code: { type: "string", description: SAVED_CODE_DESCRIPTION },
		page: {
			type: "string",
			enum: ["ready", "dirty"],
			description: PAGE_DESCRIPTION,
		},
		reason: { type: "string", description: REASON_DESCRIPTION },
	},
	required: ["code", "page", "reason"],
	additionalProperties: false,
} as const;

const REGENERATE_SCHEMA = {
	type: "object",
	properties: {
		steps: {
			type: "array",
			items: { type: "string" },
			description: "The exact text of each step to redo.",
		},
		reason: { type: "string", description: REASON_DESCRIPTION },
	},
	required: ["steps", "reason"],
	additionalProperties: false,
} as const;

const FINISH_SCHEMA = {
	type: "object",
	properties: {
		code: { type: "string", description: SAVED_CODE_DESCRIPTION },
		page: {
			type: "string",
			enum: ["ready", "dirty"],
			description: PAGE_DESCRIPTION,
		},
	},
	required: ["code", "page"],
	additionalProperties: false,
} as const;

const RUN_SCHEMA = {
	type: "object",
	properties: {
		code: { type: "string", description: RUN_CODE_DESCRIPTION },
	},
	required: ["code"],
	additionalProperties: false,
} as const;

const GIVE_UP_SCHEMA = {
	type: "object",
	properties: {
		reason: { type: "string", description: "What stopped the step." },
	},
	required: ["reason"],
	additionalProperties: false,
} as const;

const NO_INPUT_SCHEMA = {
	type: "object",
	properties: {},
	additionalProperties: false,
} as const;

export interface ToolText {
	description: string;
	schema: JSONSchema7;
}

/** How to use each tool. These apply whatever the prompts say. */
export const TOOL_TEXT = {
	run: {
		description:
			"Runs Playwright statements on the live page. Actions really happen, so never repeat one that worked.",
		schema: RUN_SCHEMA,
	},
	look: {
		description: "Shows a screenshot of the page, with its ARIA snapshot.",
		schema: NO_INPUT_SCHEMA,
	},
	finish: {
		description:
			"Saves the final code for this step. Ends the task. The code is replayed in later runs on a fresh page.",
		schema: FINISH_SCHEMA,
	},
	give_up: {
		description: "Stops without saving, because the step can't be done.",
		schema: GIVE_UP_SCHEMA,
	},
	repair: {
		description: `Replaces the failed step's code, after you've done the step on the page with \`run\`. Ends the task. The code replaces the whole step and is replayed in later runs, starting from where the previous step left the page. Write it for that starting point, not for the page in front of you. If the failed step left a menu open or a form half filled, that won't be there in a replay, so don't add anything to deal with it. Use \`page: "dirty"\` instead.`,
		schema: REPAIR_SCHEMA,
	},
	regenerate: {
		description:
			"Throws away these steps. The next attempt generates them from a clean page. Anything else in the test stays as it is.",
		schema: REGENERATE_SCHEMA,
	},
	fail: {
		description:
			"Leaves the steps alone, because the app has a real bug or this looks like a one-off.",
		schema: REASON_SCHEMA,
	},
} satisfies Record<string, ToolText>;

/** Only the latest output matters, and pages can log a lot. */
const MAX_CONSOLE_LINES = 20;

export function describeTask(task: GenerateTask): string {
	return [
		`Step: ${task.intent}`,
		`Test: ${task.testTitle}`,
		task.variableNames.length > 0
			? `Variables: ${task.variableNames.map((name) => `vars.${name}`).join(", ")}`
			: "Variables: none",
		task.previousSteps.length > 0
			? `Steps already done in this test:\n${task.previousSteps.map((step) => `- ${step}`).join("\n")}`
			: "Steps already done in this test: none",
		`Test file ${task.testFile.path}, with this step marked ">>":\n${markLine(task.testFile.source, task.testFile.line)}`,
	].join("\n\n");
}

export function describeFailure(task: DiagnoseTask): string {
	const steps = task.steps.map(
		({ intent, code }) => `Step: ${intent}\n${code}`,
	);
	return [
		task.location === "step"
			? `A saved step failed: ${task.intent}\n\nIts code:\n${task.code}\n\nThis step ${task.pageUnchanged ? "failed before it did anything to the page" : "may have changed the page before it failed"}.`
			: "A line of the hand-written test failed, after its steps ran.",
		`Error:\n${task.error}`,
		`Test: ${task.testTitle}`,
		steps.length > 0
			? `Steps that passed in this test:\n\n${steps.join("\n\n")}`
			: "No other steps have passed in this test.",
		task.extraContext ? `What else we know:\n${task.extraContext}` : "",
		`Test file ${task.testFile.path}${task.testFile.line ? ', with the step marked ">>"' : ""}:\n${markLine(task.testFile.source, task.testFile.line)}`,
	]
		.filter(Boolean)
		.join("\n\n");
}

function markLine(source: string, line: number | undefined): string {
	return source
		.split("\n")
		.map((text, index) => `${index + 1 === line ? ">> " : "   "}${text}`)
		.join("\n");
}

export function formatRunResult(result: RunResult): string {
	return [
		result.ok ? "The code ran." : `The code failed: ${result.error}`,
		result.value === undefined ? "" : `Returned: ${result.value}`,
		result.logs.length > 0 ? `Logs:\n${result.logs.join("\n")}` : "",
		formatObservation(result.observation),
	]
		.filter(Boolean)
		.join("\n\n");
}

export function formatObservation(observation: Observation): string {
	return [
		`URL: ${observation.url}`,
		`Title: ${observation.title}`,
		observation.pageErrors.length > 0
			? `Page errors:\n${observation.pageErrors.slice(-MAX_CONSOLE_LINES).join("\n")}`
			: "",
		observation.console.length > 0
			? `Console:\n${observation.console.slice(-MAX_CONSOLE_LINES).join("\n")}`
			: "",
		`ARIA snapshot:\n${observation.ariaSnapshot ?? "unavailable"}`,
		observation.testIds.length > 0
			? `Test ids on this page:\n${observation.testIds.join("\n")}`
			: "",
	]
		.filter(Boolean)
		.join("\n\n");
}
