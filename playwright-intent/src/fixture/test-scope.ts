import path from "node:path";
import type { APIRequestContext, TestInfo } from "@playwright/test";
import type { IntentAgent } from "../agent/agent";
import { createAiSdkAgent } from "../agent/ai-sdk-agent";
import { IntentNotImplementedError } from "../errors";
import {
	DEFAULT_LIMITS,
	type IntentLimits,
	type IntentMode,
	type IntentOptions,
	resolveMode,
} from "../options";
import { INTENT_DIRECTORY } from "../step/step-path";
import { createFileStore } from "../store/file-store";
import type { IntentStore } from "../store/store";

/** Everything the steps of one test attempt share. */
export interface TestScope {
	mode: IntentMode;
	agent: IntentAgent | null;
	store: IntentStore;
	limits: IntentLimits;
	testInfo: TestInfo;
	request: APIRequestContext;
	testFile: string;
	titles: string[];
	testTitle: string;
	/** Step keys used in this attempt, to catch duplicates. */
	claimedKeys: Set<string>;
	/** Intents that have finished in this attempt, in run order. */
	previousSteps: string[];
	localPath(key: string): string;
}

export function createTestScope(
	options: IntentOptions | undefined,
	testInfo: TestInfo,
	request: APIRequestContext,
): TestScope {
	const mode = resolveMode(options?.mode);
	if (mode === "all") {
		throw new IntentNotImplementedError("`all` mode isn't built yet.");
	}

	const configFile = testInfo.config.configFile;
	const root = configFile ? path.dirname(configFile) : testInfo.config.rootDir;
	const intentRoot = path.join(root, INTENT_DIRECTORY);
	const titles = testInfo.titlePath.slice(1);

	return {
		mode,
		agent:
			options?.agent ??
			(options?.model ? createAiSdkAgent(options.model) : null),
		store: options?.store ?? createFileStore(intentRoot),
		limits: { ...DEFAULT_LIMITS, ...options?.limits },
		testInfo,
		request,
		testFile: path.relative(root, testInfo.file),
		titles,
		testTitle: titles.join(" > "),
		claimedKeys: new Set(),
		previousSteps: [],
		localPath: (key) => path.join(intentRoot, ...key.split("/")),
	};
}
