import {
	defineConfig,
	devices,
	fail,
	fileStore,
	type IntentMode,
	type IntentStoreProvider,
	type IntentUseOptions,
	keep,
	type OnChange,
} from "playwright-intent";
import { createRemoteStore } from "./remote-store";
import { createScriptedAgent } from "./scripted-agent";
import { createScriptedModel, readModelScript } from "./scripted-model";

const {
	INTENT_E2E_CONFIG_MODE,
	INTENT_E2E_FAILURE_CONTEXT,
	INTENT_E2E_NO_AGENT,
	INTENT_E2E_NO_STORE,
	INTENT_E2E_ON_CHANGE,
	INTENT_E2E_REMOTE_DIR,
} = process.env;

const modelScript = readModelScript();

const onChange: OnChange =
	INTENT_E2E_ON_CHANGE === "keep" ? keep() : { local: keep(), ci: fail() };

function storeProvider(): IntentStoreProvider {
	// Flows use this to check the error for a config without a store.
	if (INTENT_E2E_NO_STORE) return undefined as never;
	if (!INTENT_E2E_REMOTE_DIR) return fileStore({ onChange });
	const directory = INTENT_E2E_REMOTE_DIR;
	return { onChange, open: () => createRemoteStore(directory) };
}

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
			store: storeProvider(),
		},
	},
});
