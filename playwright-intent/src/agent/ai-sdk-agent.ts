import type { LanguageModel } from "ai";
import { IntentNotImplementedError } from "../errors";
import type { IntentAgent } from "./agent";

/**
 * The built-in agent. It will expose `observe`, `run` and `finish` as tools,
 * and load `ai` lazily, so `none` mode never needs the optional peer.
 */
export function createAiSdkAgent(_model: LanguageModel): IntentAgent {
	const notBuilt = () => {
		throw new IntentNotImplementedError(
			"The AI SDK agent isn't built yet. Pass use.intent.agent for now.",
		);
	};
	return { generate: notBuilt, diagnose: notBuilt };
}
