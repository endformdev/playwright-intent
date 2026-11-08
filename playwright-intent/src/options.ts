import type { LanguageModel } from "ai";
import type { FailureContextProvider, IntentAgent } from "./agent/agent";
import type { IntentPrompts } from "./agent/prompts";
import { IntentError } from "./errors";
import type { IntentStoreProvider } from "./store/store";

export const INTENT_MODES = ["none", "missing", "changed", "all"] as const;

/**
 * - `none`: replay only. A miss or a failing step fails the test.
 * - `missing`: generate misses. A failing step fails the test.
 * - `changed`: generate misses, and diagnose failures with the agent.
 * - `all`: regenerate every step that runs, and diagnose failures. A retry
 *   replays what the first attempt generated.
 */
export type IntentMode = (typeof INTENT_MODES)[number];

export interface IntentLimits {
	/** Maximum agent turns for one generation or diagnosis. */
	maxTurns: number;
	/** Maximum time for one generation or diagnosis. */
	timeoutMs: number;
}

/** Set under `use.intent` in `playwright.config.ts`. */
export interface IntentOptions {
	/** Overridden by the `PW_INTENT` environment variable. */
	mode?: IntentMode;
	/** The AI SDK model used by the built-in agent. */
	model?: LanguageModel;
	/**
	 * Replaces the built-in agent, and takes priority over `model`.
	 *
	 * @internal Only for this library's own tests. Not a supported API.
	 */
	agent?: IntentAgent;
	/**
	 * Replaces the built-in agent's instructions. Build on `defaultPrompts` to
	 * add to them. Can't be combined with `agent`.
	 */
	prompts?: Partial<IntentPrompts>;
	/** Where steps are stored, and what happens when they change. */
	store: IntentStoreProvider;
	/** Adds your own text, like failure history, to a diagnosis. */
	context?: FailureContextProvider;
	limits?: Partial<IntentLimits>;
}

/** Pass to `defineConfig<IntentUseOptions>` to type `use.intent`. */
export interface IntentUseOptions {
	intent?: IntentOptions;
}

export const DEFAULT_LIMITS: IntentLimits = {
	maxTurns: 30,
	timeoutMs: 180_000,
};

/**
 * `PW_INTENT` wins, then `use.intent.mode`. CI has no default of its own:
 * the required `onChange` decides whether steps can change there.
 */
export function resolveMode(
	configured: IntentMode | undefined,
	env: NodeJS.ProcessEnv = process.env,
): IntentMode {
	const mode = env.PW_INTENT || configured || "missing";
	if (!INTENT_MODES.includes(mode as IntentMode)) {
		throw new IntentError(
			`Unknown intent mode "${mode}". Use one of: ${INTENT_MODES.join(", ")}.`,
		);
	}
	return mode as IntentMode;
}
