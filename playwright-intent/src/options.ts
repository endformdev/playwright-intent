import type { LanguageModel } from "ai";
import type { FailureContextProvider, IntentAgent } from "./agent/agent";
import type { IntentPrompts } from "./agent/prompts";
import { IntentConfigError } from "./errors";
import type { IntentStoreProvider } from "./store/store";

export interface IntentLimits {
	/** Maximum agent turns for one generation or diagnosis. */
	maxTurns: number;
	/** Maximum time for one generation or diagnosis. */
	timeoutMs: number;
}

/**
 * Pass the same object to `use.intent` and to `playwright-intent/reporter`,
 * so tests and the reporter agree on where steps go.
 */
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
	/** Where steps are stored, and how the agent's changes to them are kept. */
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

export const CONFIG_EXAMPLE = `const intent = {
	model,
	store: fileStore({ updates: { local: allow(), ci: refuse() } }),
} satisfies IntentOptions;

export default defineConfig<IntentUseOptions>({
	reporter: [["list"], ["playwright-intent/reporter", intent]],
	use: { intent },
});`;

/** `use` is partial in Playwright's types, so `intent` can be left out. */
export function assertIntentOptions(
	options: Partial<IntentOptions> | undefined,
): asserts options is IntentOptions {
	if (!options?.store?.updates) {
		throw new IntentConfigError(
			`Set use.intent.store in playwright.config.ts, and pass the same options to the reporter:\n\n${CONFIG_EXAMPLE}`,
		);
	}
	if (options.agent && options.prompts) {
		throw new IntentConfigError(
			"use.intent.prompts only applies to the built-in agent, so it can't " +
				"be combined with use.intent.agent.",
		);
	}
}
