import type { LanguageModel, ToolSet } from "ai";
import { IntentNotImplementedError } from "../errors";
import type {
	AgentSession,
	GenerateOutcome,
	GenerateTask,
	IntentAgent,
	Observation,
	RunResult,
} from "./agent";

const GENERATE_INSTRUCTIONS = `You turn one natural-language step of a Playwright test into code.

You work on a real browser page, which is already where the test has left it. Use \`run\` to carry out the step for real, one action at a time. Actions you run really happen, so never repeat one that worked. Then call \`finish\` with the final code. If the step can't be done, call \`give_up\`.

Code passed to \`run\` and \`finish\` is a list of statements in an async function, with \`page\`, \`context\`, \`request\`, \`expect\` and \`vars\` in scope. Nothing is shared between runs except the browser. \`return\` a value or use \`console.log\` to see something. Actions in \`run\` time out after 5 seconds.

The code you finish with is saved and replayed in later test runs without you, on a fresh page, so:
- Do exactly what the step says. The test file shows what happens around the step, so leave later work to it, and leave the page where the following code expects it.
- Prefer \`getByTestId\` when an element has a test id, because its text can change. Otherwise ask Playwright for the best locator, and use what it returns: \`return String(await page.locator("aria-ref=e6").normalize())\`.
- \`aria-ref\` values only last for one snapshot, so never put them in the final code.
- Later runs have different data. Never rely on text that only this run has, like generated names, initials, ids or dates.
- Read variables from \`vars\`, like \`vars.email\`. You don't get their values.
- End with an \`expect\` that proves this step happened. Leave the test's own assertions to the test, and don't copy values from the test file unless the step names them.
- Tests run against different addresses, so match URLs by path, never by host.
- Wait for conditions, never for a fixed time. Don't use \`force: true\` or \`dispatchEvent\`.
- Include only what the step needs, not your exploration. Put each statement on its own line.
- Before finishing, run every assertion in the final code exactly as you'll save it, and fix any that fail.

Finish with \`page: "ready"\` when the page is where your code would leave it. Use \`page: "dirty"\` when your code is right but exploring left the page somewhere else, for example if you submitted a form twice.

If the app looks broken, or the step asks for something that isn't there, call \`give_up\` and say why. Don't work around it.`;

const FINISH_SCHEMA = {
	type: "object",
	properties: {
		code: { type: "string", description: "The statements to save." },
		page: { type: "string", enum: ["ready", "dirty"] },
	},
	required: ["code", "page"],
	additionalProperties: false,
} as const;

const RUN_SCHEMA = {
	type: "object",
	properties: {
		code: { type: "string", description: "Playwright statements to run now." },
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

/** Only the latest output matters, and pages can log a lot. */
const MAX_CONSOLE_LINES = 20;

/** The built-in agent. `ai` loads lazily, so replaying never needs the peer. */
export function createAiSdkAgent(model: LanguageModel): IntentAgent {
	return {
		generate: (task, session) => generate(model, task, session),
		diagnose: async () => {
			throw new IntentNotImplementedError(
				"The built-in agent can't diagnose failures yet.",
			);
		},
	};
}

async function generate(
	model: LanguageModel,
	task: GenerateTask,
	session: AgentSession,
): Promise<GenerateOutcome> {
	const { generateText, isStepCount, jsonSchema, tool } = await import("ai");

	const transcript: string[] = [];
	const tools = {
		run: tool({
			description: "Runs Playwright statements on the live page.",
			inputSchema: jsonSchema<{ code: string }>(RUN_SCHEMA),
			execute: async ({ code }) => {
				const output = formatRunResult(await session.run(code));
				transcript.push(`--- run\n${code}\n--- result\n${output}`);
				return output;
			},
		}),
		look: tool({
			description: "Shows a screenshot of the page, with its ARIA snapshot.",
			inputSchema: jsonSchema<Record<string, never>>(NO_INPUT_SCHEMA),
			execute: async () => {
				const observation = await session.observe();
				transcript.push("--- look");
				return {
					text: formatObservation(observation),
					screenshot: observation.screenshot?.toString("base64") ?? null,
				};
			},
			toModelOutput: ({ output }) => ({
				type: "content",
				value: [
					{ type: "text", text: output.text },
					...(output.screenshot
						? [
								{
									type: "file" as const,
									mediaType: "image/png",
									data: { type: "data" as const, data: output.screenshot },
								},
							]
						: []),
				],
			}),
		}),
		finish: tool({
			description: "Saves the final code for this step. Ends the task.",
			inputSchema: jsonSchema<{ code: string; page: "ready" | "dirty" }>(
				FINISH_SCHEMA,
			),
		}),
		give_up: tool({
			description: "Stops without saving, because the step can't be done.",
			inputSchema: jsonSchema<{ reason: string }>(GIVE_UP_SCHEMA),
		}),
	} satisfies ToolSet;

	const result = await generateText({
		model,
		instructions: GENERATE_INSTRUCTIONS,
		prompt: describeTask(task),
		tools,
		toolChoice: "required",
		stopWhen: isStepCount(task.limits.maxTurns),
		abortSignal: AbortSignal.timeout(task.limits.timeoutMs),
		providerOptions: { openai: { parallelToolCalls: false } },
	});

	const turns = result.steps.length;
	const { inputTokens, outputTokens } = result.totalUsage;
	transcript.push(
		`--- ${turns} turns, ${inputTokens} input tokens, ${outputTokens} output tokens`,
	);

	for (const call of result.staticToolCalls) {
		if (call.toolName === "finish") {
			const { code, page } = call.input;
			transcript.push(`--- finish (${page})\n${code}`);
			return {
				status: "solved",
				code,
				page,
				transcript: transcript.join("\n"),
			};
		}
		if (call.toolName === "give_up") {
			const { reason } = call.input;
			transcript.push(`--- give up\n${reason}`);
			return {
				status: "failed",
				message: reason,
				transcript: transcript.join("\n"),
			};
		}
	}

	return {
		status: "failed",
		message: `The agent didn't finish within ${task.limits.maxTurns} turns.`,
		transcript: transcript.join("\n"),
	};
}

function describeTask(task: GenerateTask): string {
	const sections = [
		`Step: ${task.intent}`,
		`Test: ${task.testTitle}`,
		task.variableNames.length > 0
			? `Variables: ${task.variableNames.map((name) => `vars.${name}`).join(", ")}`
			: "Variables: none",
		task.previousSteps.length > 0
			? `Steps already done in this test:\n${task.previousSteps.map((step) => `- ${step}`).join("\n")}`
			: "Steps already done in this test: none",
		`Test file ${task.testFile.path}, with this step marked ">>":\n${markLine(task.testFile.source, task.testFile.line)}`,
	];
	if (task.previousFailure) {
		sections.push(
			`An earlier attempt failed.\nCode:\n${task.previousFailure.code}\nError:\n${task.previousFailure.error}`,
		);
	}
	return sections.join("\n\n");
}

function markLine(source: string, line: number | undefined): string {
	return source
		.split("\n")
		.map((text, index) => `${index + 1 === line ? ">> " : "   "}${text}`)
		.join("\n");
}

function formatRunResult(result: RunResult): string {
	return [
		result.ok ? "The code ran." : `The code failed: ${result.error}`,
		result.value === undefined ? "" : `Returned: ${result.value}`,
		result.logs.length > 0 ? `Logs:\n${result.logs.join("\n")}` : "",
		formatObservation(result.observation),
	]
		.filter(Boolean)
		.join("\n\n");
}

function formatObservation(observation: Observation): string {
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
