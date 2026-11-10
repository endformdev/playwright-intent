import {
	defaultPrompts,
	defineConfig,
	devices,
	type IntentOptions,
	type IntentStoreProvider,
	type IntentUseOptions,
} from "playwright-intent";
import {
	allow,
	commit,
	type FileStoreUpdates,
	fileStore,
	propose,
	refuse,
	type UpdatePolicy,
} from "playwright-intent/file-store";
import { remoteStore, shared } from "playwright-intent/remote-store";
import { createScriptedAgent } from "./scripted-agent";
import { createScriptedModel, readModelScript } from "./scripted-model";

const {
	INTENT_E2E_BLOB,
	INTENT_E2E_CACHE_TOKEN,
	INTENT_E2E_CACHE_URL,
	INTENT_E2E_DIAGNOSE_PROMPT,
	INTENT_E2E_FAILURE_CONTEXT,
	INTENT_E2E_GENERATE_PROMPT,
	INTENT_E2E_NO_AGENT,
	INTENT_E2E_NO_REPORTER,
	INTENT_E2E_NO_REPORTER_OPTIONS,
	INTENT_E2E_NO_STORE,
	INTENT_E2E_UPDATES,
} = process.env;

const modelScript = readModelScript();

const POLICIES: Record<string, () => UpdatePolicy> = {
	allow,
	commit,
	propose,
	refuse,
};

const updates: FileStoreUpdates = POLICIES[INTENT_E2E_UPDATES ?? ""]?.() ?? {
	local: allow(),
	ci: refuse(),
};

function storeProvider(): IntentStoreProvider {
	// Flows use this to check the error for a config without a store.
	if (INTENT_E2E_NO_STORE) return undefined as never;
	if (INTENT_E2E_CACHE_URL) {
		return remoteStore({
			url: INTENT_E2E_CACHE_URL,
			token: INTENT_E2E_CACHE_TOKEN,
			updates: shared(),
		});
	}
	return fileStore({ updates });
}

function intentReporter() {
	if (INTENT_E2E_NO_REPORTER) return [];
	return INTENT_E2E_NO_REPORTER_OPTIONS
		? ([["playwright-intent/reporter"]] as const)
		: ([["playwright-intent/reporter", intent]] as const);
}

/** `{default}` stands for the built-in text, so flows can build on it. */
function customPrompts() {
	if (!INTENT_E2E_GENERATE_PROMPT && !INTENT_E2E_DIAGNOSE_PROMPT) {
		return undefined;
	}
	return {
		generate: INTENT_E2E_GENERATE_PROMPT?.replace(
			"{default}",
			defaultPrompts.generate,
		),
		diagnose: INTENT_E2E_DIAGNOSE_PROMPT?.replace(
			"{default}",
			defaultPrompts.diagnose,
		),
	};
}

const intent = {
	model: modelScript ? createScriptedModel(modelScript) : undefined,
	limits: modelScript?.limits,
	agent: INTENT_E2E_NO_AGENT || modelScript ? undefined : createScriptedAgent(),
	prompts: customPrompts(),
	context: () => INTENT_E2E_FAILURE_CONTEXT,
	store: storeProvider(),
} satisfies IntentOptions;

export default defineConfig<IntentUseOptions>({
	testDir: "./tests",
	outputDir: "./results",
	workers: 1,
	timeout: 20_000,
	expect: { timeout: 1_000 },
	reporter: [
		["json", { outputFile: "report.json" }],
		...intentReporter(),
		...(INTENT_E2E_BLOB ? ([["blob"]] as const) : []),
	],
	use: {
		...devices["Desktop Chrome"],
		baseURL: "http://shop.test",
		actionTimeout: 1_000,
		trace: "on",
		intent,
	},
});
