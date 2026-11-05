import { stripTypeScriptTypes } from "node:module";
import type { StepContext } from "../step/run-step";
import type { AgentSession, RunResult } from "./agent";
import { observePage } from "./observe";

const AsyncFunction = (async () => {}).constructor as new (
	...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

/**
 * Exploration runs through this instead of a step file. It isn't kept, so it
 * doesn't need the loader, and the agent is free to be as messy as it likes.
 */
export function createAgentSession(context: StepContext): AgentSession {
	return {
		observe: () => observePage(context.page),

		async run(code) {
			const logs: string[] = [];
			const log = (...args: unknown[]) => void logs.push(args.join(" "));
			const capturedConsole = { log, info: log, warn: log, error: log };
			const result: Pick<RunResult, "ok" | "value" | "error"> = { ok: true };

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
			}

			return {
				...result,
				logs,
				observation: await observePage(context.page),
			};
		},
	};
}
