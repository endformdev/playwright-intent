import { stripTypeScriptTypes } from "node:module";
import type { StepContext } from "../step/run-step";
import type { AgentSession, RunResult } from "./agent";
import { observePage } from "./observe";

/** Keeps a wrong guess from using up the agent's time. */
const EXPLORATION_ACTION_TIMEOUT_MS = 5_000;

export interface SessionOptions {
	/** `use.actionTimeout`, restored after each run. */
	actionTimeout: number | undefined;
	/** `use.testIdAttribute`. */
	testIdAttribute: string;
}

const AsyncFunction = (async () => {}).constructor as new (
	...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

/**
 * Exploration runs through this instead of a step file. It isn't kept, so it
 * doesn't need the loader, and the agent is free to be as messy as it likes.
 */
export function createAgentSession(
	context: StepContext,
	{ actionTimeout, testIdAttribute }: SessionOptions,
): AgentSession {
	return {
		observe: () => observePage(context.page, testIdAttribute),

		async run(code) {
			const logs: string[] = [];
			const log = (...args: unknown[]) => void logs.push(args.join(" "));
			const capturedConsole = { log, info: log, warn: log, error: log };
			const result: Pick<RunResult, "ok" | "value" | "error"> = { ok: true };

			context.context.setDefaultTimeout(EXPLORATION_ACTION_TIMEOUT_MS);
			try {
				const run = new AsyncFunction(
					"{ page, context, request, expect, vars, console }",
					stripTypeScriptTypes(code),
				);
				const value = await run({ ...context, console: capturedConsole });
				if (value !== undefined) result.value = String(value);
			} catch (error) {
				result.ok = false;
				result.error = error instanceof Error ? error.message : String(error);
			} finally {
				// The same call Playwright makes for `use.actionTimeout`.
				context.context.setDefaultTimeout(actionTimeout || 0);
			}

			return {
				...result,
				logs,
				observation: await observePage(context.page, testIdAttribute),
			};
		},
	};
}
