import type { JSONSchema7, LanguageModel, ToolSet } from "ai";
import type {
	AgentSession,
	DiagnoseOutcome,
	DiagnoseTask,
	GenerateOutcome,
	GenerateTask,
	IntentAgent,
	Observation,
	RunResult,
} from "./agent";

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

const GENERATE_INSTRUCTIONS = `You turn one natural-language step of a Playwright test into code.

You work on a real browser page, which is already where the test has left it. Use \`run\` to carry out the step for real, one action at a time. Actions you run really happen, so never repeat one that worked. Then call \`finish\` with the final code. If the step can't be done, call \`give_up\`.

Code passed to \`run\` and \`finish\` is a list of statements in an async function, with \`page\`, \`context\`, \`request\`, \`expect\` and \`vars\` in scope. Nothing is shared between runs except the browser. \`return\` a value or use \`console.log\` to see something. Actions in \`run\` time out after 5 seconds.

The code you finish with is saved and replayed in later test runs without you, on a fresh page, so:
- Do exactly what the step says. The test file shows what happens around the step, so leave later work to it, and leave the page where the following code expects it.
- End with an \`expect\` that proves this step happened. Leave the test's own assertions to the test, and don't copy values from the test file unless the step names them.
${STEP_CODE_RULES}

Finish with \`page: "ready"\` when the page is where your code would leave it. Use \`page: "dirty"\` when your code is right but exploring left the page somewhere else, for example if you submitted a form twice.

If the app looks broken, or the step asks for something that isn't there, call \`give_up\` and say why. Don't work around it.`;

const DIAGNOSE_INSTRUCTIONS = `A Playwright test just failed. You're on the real page it failed on, and you decide what happens next.

The test's steps are saved code, generated earlier from natural language. What you decide depends on why the test failed:

- The app works, but the saved code no longer matches it, because the UI changed. Fix it with \`repair\` if the failed step alone is wrong, or \`regenerate\` if other steps need redoing too, or the page is too far along to fix from here.
- The app is wrong: a server error, an error page, missing data, or a feature that doesn't do what the test expects. Call \`fail\` and say what's broken. A test that finds a bug has done its job, so don't touch the steps.
- It looks like a one-off, like a slow response or a network error, and the page works when you check. Call \`rerun\`.

Look before you decide. Use \`run\` to read the page, try locators, and check whether the app really works. The page is live, so anything you do really happens. Code passed to \`run\` is a list of statements in an async function, with \`page\`, \`context\`, \`request\`, \`expect\` and \`vars\` in scope. \`return\` a value or use \`console.log\` to see something. Actions time out after 5 seconds.

To \`repair\`, carry out the step for real with \`run\`, then pass the final code. Use \`page: "ready"\` when the page is where your code would leave it, and \`page: "dirty"\` when it isn't. The code replaces the whole step and is replayed in later runs, starting from where the previous step left the page. So:
- Write it for that starting point, not for the page in front of you. If the failed step left a menu open or a form half filled, that won't be there in a replay, so don't add anything to deal with it. Use \`page: "dirty"\` instead.
- Keep what the step checks. Update a locator or a label, but never remove or loosen an assertion to get past a failure. If the old assertion was right and the app no longer meets it, that's a \`fail\`.
${STEP_CODE_RULES}

\`regenerate\` takes the exact text of the steps to redo. Anything else in the test stays as it is.`;

const REASON_SCHEMA = {
	type: "object",
	properties: {
		reason: { type: "string", description: "Why, in one sentence." },
	},
	required: ["reason"],
	additionalProperties: false,
} as const;

const REPAIR_SCHEMA = {
	type: "object",
	properties: {
		code: { type: "string", description: "The statements to save." },
		page: { type: "string", enum: ["ready", "dirty"] },
		reason: { type: "string", description: "Why, in one sentence." },
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
		reason: { type: "string", description: "Why, in one sentence." },
	},
	required: ["steps", "reason"],
	additionalProperties: false,
} as const;

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
		diagnose: (task, session) => diagnose(model, task, session),
	};
}

interface EndTool {
	description: string;
	schema: JSONSchema7;
}

interface Run {
	instructions: string;
	prompt: string;
	maxTurns: number;
	timeoutMs: number;
	/** Tools that end the task. They run nothing: the call is the answer. */
	endTools: Record<string, EndTool>;
}

interface AgentRun {
	/** The end tool the agent called, if it got that far. */
	end: { name: string; input: unknown } | null;
	transcript: string[];
}

async function runAgent(
	model: LanguageModel,
	session: AgentSession,
	run: Run,
): Promise<AgentRun> {
	const { generateText, isStepCount, jsonSchema, tool } = await import("ai");

	const transcript: string[] = [];
	const tools: ToolSet = {
		run: tool({
			description: "Runs Playwright statements on the live page.",
			inputSchema: jsonSchema<{ code: string }>(RUN_SCHEMA),
			strict: true,
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
		...Object.fromEntries(
			Object.entries(run.endTools).map(([name, { description, schema }]) => [
				name,
				tool({ description, inputSchema: jsonSchema(schema), strict: true }),
			]),
		),
	};

	const result = await generateText({
		model,
		instructions: run.instructions,
		prompt: run.prompt,
		tools,
		toolChoice: "required",
		stopWhen: isStepCount(run.maxTurns),
		abortSignal: AbortSignal.timeout(run.timeoutMs),
		providerOptions: { openai: { parallelToolCalls: false } },
	});

	const { inputTokens, outputTokens } = result.totalUsage;
	transcript.push(
		`--- ${result.steps.length} turns, ${inputTokens} input tokens, ${outputTokens} output tokens`,
	);

	const call = result.toolCalls.find(
		({ toolName }) => toolName in run.endTools,
	);
	if (call) {
		transcript.push(
			`--- ${call.toolName}\n${JSON.stringify(call.input, null, 2)}`,
		);
	}
	return {
		end: call ? { name: call.toolName, input: call.input } : null,
		transcript,
	};
}

async function generate(
	model: LanguageModel,
	task: GenerateTask,
	session: AgentSession,
): Promise<GenerateOutcome> {
	const { end, transcript: lines } = await runAgent(model, session, {
		instructions: GENERATE_INSTRUCTIONS,
		prompt: describeTask(task),
		maxTurns: task.limits.maxTurns,
		timeoutMs: task.limits.timeoutMs,
		endTools: {
			finish: {
				description: "Saves the final code for this step. Ends the task.",
				schema: FINISH_SCHEMA,
			},
			give_up: {
				description: "Stops without saving, because the step can't be done.",
				schema: GIVE_UP_SCHEMA,
			},
		},
	});
	const transcript = lines.join("\n");

	if (end?.name === "finish") {
		const { code, page } = end.input as {
			code: string;
			page: "ready" | "dirty";
		};
		return { status: "solved", code, page, transcript };
	}
	if (end?.name === "give_up") {
		const { reason } = end.input as { reason: string };
		return { status: "failed", message: reason, transcript };
	}
	return {
		status: "failed",
		message: `The agent didn't finish within ${task.limits.maxTurns} turns.`,
		transcript,
	};
}

async function diagnose(
	model: LanguageModel,
	task: DiagnoseTask,
	session: AgentSession,
): Promise<DiagnoseOutcome> {
	const observation = await session.observe();
	const { end, transcript: lines } = await runAgent(model, session, {
		instructions: DIAGNOSE_INSTRUCTIONS,
		prompt: `${describeFailure(task)}\n\nThe page now:\n${formatObservation(observation)}`,
		maxTurns: task.limits.maxTurns,
		timeoutMs: task.limits.timeoutMs,
		endTools: {
			...(task.location === "step"
				? {
						repair: {
							description:
								"Saves new code for the failed step, after you've done the step on the page.",
							schema: REPAIR_SCHEMA,
						},
					}
				: {}),
			regenerate: {
				description:
					"Throws away these steps. The next attempt generates them from a clean page.",
				schema: REGENERATE_SCHEMA,
			},
			rerun: {
				description:
					"Leaves the steps alone, because this looks like a one-off.",
				schema: REASON_SCHEMA,
			},
			fail: {
				description: "Leaves the steps alone, because the app has a real bug.",
				schema: REASON_SCHEMA,
			},
		},
	});
	const transcript = lines.join("\n");

	switch (end?.name) {
		case "repair": {
			const input = end.input as {
				code: string;
				page: "ready" | "dirty";
				reason: string;
			};
			return { action: "repair", ...input, transcript };
		}
		case "regenerate": {
			const input = end.input as { steps: string[]; reason: string };
			return { action: "regenerate", ...input, transcript };
		}
		case "rerun":
		case "fail": {
			const { reason } = end.input as { reason: string };
			return { action: end.name, reason, transcript };
		}
		default:
			return {
				action: "fail",
				reason: `The agent didn't decide within ${task.limits.maxTurns} turns.`,
				transcript,
			};
	}
}

function describeFailure(task: DiagnoseTask): string {
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
		task.regeneratedSteps.length > 0
			? `Already regenerated after an earlier failure, so doing that again probably won't help:\n${task.regeneratedSteps.map((step) => `- ${step}`).join("\n")}`
			: "",
		task.extraContext ? `What else we know:\n${task.extraContext}` : "",
		`Test file ${task.testFile.path}${task.testFile.line ? ', with the step marked ">>"' : ""}:\n${markLine(task.testFile.source, task.testFile.line)}`,
	]
		.filter(Boolean)
		.join("\n\n");
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
