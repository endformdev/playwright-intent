import {
	defineConfig,
	devices,
	type IntentMode,
	type IntentUseOptions,
} from "playwright-intent";
import { createRemoteStore } from "./remote-store";
import { createScriptedAgent } from "./scripted-agent";

const { INTENT_E2E_CONFIG_MODE, INTENT_E2E_NO_AGENT, INTENT_E2E_REMOTE_DIR } =
	process.env;

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
			agent: INTENT_E2E_NO_AGENT ? undefined : createScriptedAgent(),
			store: INTENT_E2E_REMOTE_DIR
				? createRemoteStore(INTENT_E2E_REMOTE_DIR)
				: undefined,
		},
	},
});
