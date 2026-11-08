import type { LanguageModel, ToolSet } from "ai";
import type {
	AgentSession,
	DiagnoseOutcome,
	DiagnoseTask,
	GenerateOutcome,
	GenerateTask,
	IntentAgent,
} from "./agent";
import {
	defaultPrompts,
	describeFailure,
	describeTask,
	formatObservation,
	formatRunResult,
	type IntentPrompts,
	TOOL_TEXT,
	type ToolText,
} from "./prompts";

/** The built-in agent. `ai` loads lazily, so replaying never needs the peer. */
export function createAiSdkAgent(
	model: LanguageModel,
	prompts?: Partial<IntentPrompts>,
): IntentAgent {
	const generateInstructions = prompts?.generate ?? defaultPrompts.generate;
	const diagnoseInstructions = prompts?.diagnose ?? defaultPrompts.diagnose;

	return {
		generate: (task, session) =>
			generate(model, generateInstructions, task, session),
		diagnose: (task, session) =>
			diagnose(model, diagnoseInstructions, task, session),
	};
}

interface Run {
	instructions: string;
	prompt: string;
	maxTurns: number;
	timeoutMs: number;
	/** Tools that end the task. They run nothing: the call is the answer. */
	endTools: Record<string, ToolText>;
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
			description: TOOL_TEXT.run.description,
			inputSchema: jsonSchema<{ code: string }>(TOOL_TEXT.run.schema),
			strict: true,
			execute: async ({ code }) => {
				const output = formatRunResult(await session.run(code));
				transcript.push(`--- run\n${code}\n--- result\n${output}`);
				return output;
			},
		}),
		look: tool({
			description: TOOL_TEXT.look.description,
			inputSchema: jsonSchema<Record<string, never>>(TOOL_TEXT.look.schema),
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
	instructions: string,
	task: GenerateTask,
	session: AgentSession,
): Promise<GenerateOutcome> {
	const { end, transcript: lines } = await runAgent(model, session, {
		instructions,
		prompt: describeTask(task),
		maxTurns: task.limits.maxTurns,
		timeoutMs: task.limits.timeoutMs,
		endTools: { finish: TOOL_TEXT.finish, give_up: TOOL_TEXT.give_up },
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
	instructions: string,
	task: DiagnoseTask,
	session: AgentSession,
): Promise<DiagnoseOutcome> {
	const observation = await session.observe();
	const { end, transcript: lines } = await runAgent(model, session, {
		instructions,
		prompt: `${describeFailure(task)}\n\nThe page now:\n${formatObservation(observation)}`,
		maxTurns: task.limits.maxTurns,
		timeoutMs: task.limits.timeoutMs,
		endTools: {
			...(task.location === "step" ? { repair: TOOL_TEXT.repair } : {}),
			regenerate: TOOL_TEXT.regenerate,
			fail: TOOL_TEXT.fail,
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
		case "fail": {
			const { reason } = end.input as { reason: string };
			return { action: "fail", reason, transcript };
		}
		default:
			return {
				action: "fail",
				reason: `The agent didn't decide within ${task.limits.maxTurns} turns.`,
				transcript,
			};
	}
}
