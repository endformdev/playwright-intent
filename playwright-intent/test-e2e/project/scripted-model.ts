import fs from "node:fs";
import { MockLanguageModelV4 } from "ai/test";

/** One model response: the tool it calls next. */
export interface ModelTurn {
	tool: "run" | "look" | "finish" | "give_up" | "fail";
	input: Record<string, unknown>;
}

export interface ModelScript {
	turns: ModelTurn[];
	maxTurns?: number;
}

export const MODEL_SCRIPT_FILE = "model-script.json";
export const MODEL_CALLS_FILE = "model-calls.jsonl";

const USAGE = {
	inputTokens: {
		total: 1,
		noCache: 1,
		cacheRead: undefined,
		cacheWrite: undefined,
	},
	outputTokens: { total: 1, text: 1, reasoning: undefined },
};

export function readModelScript(): ModelScript | null {
	if (!fs.existsSync(MODEL_SCRIPT_FILE)) return null;
	return JSON.parse(fs.readFileSync(MODEL_SCRIPT_FILE, "utf8")) as ModelScript;
}

function countCalls(): number {
	if (!fs.existsSync(MODEL_CALLS_FILE)) return 0;
	return fs.readFileSync(MODEL_CALLS_FILE, "utf8").trim().split("\n").length;
}

/**
 * Replaces the provider, so flows cover the real built-in agent without a
 * network. Calls are logged to a file because a retry is a new process.
 */
export function createScriptedModel(script: ModelScript) {
	return new MockLanguageModelV4({
		doGenerate: async ({ prompt, tools }) => {
			const index = countCalls();
			const turn = script.turns[index];
			fs.appendFileSync(
				MODEL_CALLS_FILE,
				`${JSON.stringify({ prompt, tools })}\n`,
			);
			if (!turn) throw new Error(`Unscripted model turn ${index}.`);

			return {
				content: [
					{
						type: "tool-call",
						toolCallId: `call-${index}`,
						toolName: turn.tool,
						input: JSON.stringify(turn.input),
					},
				],
				finishReason: { unified: "tool-calls", raw: undefined },
				usage: USAGE,
				warnings: [],
			};
		},
	});
}
