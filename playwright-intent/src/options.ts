import type { LanguageModel } from "ai";
import type { FailureContextProvider, IntentAgent } from "./agent/agent";
import type { IntentPrompts } from "./agent/prompts";
import type { IntentStoreProvider } from "./store/store";

export interface IntentLimits {
	/** Maximum agent turns for one generation or diagnosis. */
	maxTurns: number;
	/** Maximum time for one generation or diagnosis. */
	timeoutMs: number;
}

/** Set under `use.intent` in `playwright.config.ts`. */
export interface IntentOptions {
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
