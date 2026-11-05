import {
	defineConfig,
	devices,
	type IntentMode,
	type IntentUseOptions,
} from "playwright-intent";
import { createRemoteStore } from "./remote-store";
import { createScriptedAgent } from "./scripted-agent";
import { createScriptedModel, readModelScript } from "./scripted-model";

const {
	INTENT_E2E_CONFIG_MODE,
	INTENT_E2E_FAILURE_CONTEXT,
	INTENT_E2E_NO_AGENT,
	INTENT_E2E_REMOTE_DIR,
} = process.env;

const modelScript = readModelScript();

export default defineConfig<IntentUseOptions>({
	testDir: "./tests",
	outputDir: "./results",
	workers: 1,
	timeout: 20_000,
	expect: { timeout: 1_000 },
	reporter: [["json", { outputFile: "report.json" }]],
	use: {
		...devices["Desktop Chrome"],
		baseURL: "http://shop.test",
		actionTimeout: 1_000,
		trace: "on",
		intent: {
			mode: INTENT_E2E_CONFIG_MODE as IntentMode | undefined,
			model: modelScript ? createScriptedModel(modelScript) : undefined,
			limits: modelScript?.maxTurns
				? { maxTurns: modelScript.maxTurns }
				: undefined,
			agent:
				INTENT_E2E_NO_AGENT || modelScript ? undefined : createScriptedAgent(),
			context: () => INTENT_E2E_FAILURE_CONTEXT,
			store: INTENT_E2E_REMOTE_DIR
				? createRemoteStore(INTENT_E2E_REMOTE_DIR)
				: undefined,
		},
	},
});
