import { pathToFileURL } from "node:url";
import {
	type APIRequestContext,
	type BrowserContext,
	expect,
	type Page,
	test,
} from "@playwright/test";
import { createAgentSession } from "../agent/session";
import {
	IntentAgentFailedError,
	IntentDuplicateStepError,
	IntentError,
	IntentNoAgentError,
	IntentRewindError,
	IntentStepConflictError,
} from "../errors";
import { readTestFile } from "../fixture/test-file";
import type { TestScope } from "../fixture/test-scope";
import { materializeStep } from "../store/local-files";
import { handleStepFailure } from "./handle-failure";
import {
	assertVariablesMatch,
	placeholderNames,
	type StepVariables,
} from "./intent-text";
import { provedOnRetry, recordChange } from "./record-change";
import { saveStep } from "./save-step";
import { parseStepCode, parseStepHeader } from "./step-file";
import { stepKey } from "./step-path";

/** What a step file receives. Steps can't import anything else at runtime. */
export interface StepContext {
	page: Page;
	context: BrowserContext;
	request: APIRequestContext;
	expect: typeof expect;
	vars: StepVariables;
}

type StepFunction = (context: StepContext) => Promise<void>;

/** Without `actionTimeout`, a stale locator would wait for the test timeout. */
const DIAGNOSED_ACTION_TIMEOUT_MS = 15_000;

export async function runStep(
	scope: TestScope,
	page: Page,
	intent: string,
	vars: StepVariables,
	line: number | undefined,
): Promise<void> {
	assertVariablesMatch(intent, vars);

	const key = stepKey({
		testFile: scope.testFile,
		titles: scope.titles,
		intent,
	});
	claimStep(scope, key, intent);

	const context: StepContext = {
		page,
		context: page.context(),
		request: scope.request,
		expect,
		vars,
	};

	try {
		const source = await readStep(scope, key, intent);
		const code =
			source === null
				? await generateStep(scope, context, key, intent, line)
				: await replayStep(scope, context, key, intent, source, line);
		scope.finishedSteps.push({ key, intent, code });
	} catch (error) {
		// These already explain themselves, so there's nothing to diagnose.
		if (error instanceof IntentError) scope.diagnosed = true;
		throw error;
	}
}

function claimStep(scope: TestScope, key: string, intent: string): void {
	if (scope.claimedKeys.has(key)) {
		throw new IntentDuplicateStepError(
			`"${intent}" matches another step in this test, so both would use ` +
				`.intent/${key}. Reword one of them.`,
		);
	}
	scope.claimedKeys.add(key);
}

/** Returns the stored source, or null when the step needs generating. */
async function readStep(
	scope: TestScope,
	key: string,
	intent: string,
): Promise<string | null> {
	const source = await scope.store.get(key);
	if (source === null) return null;

	const header = parseStepHeader(source);
	if (header === null || header.test !== scope.testTitle) {
		throw new IntentStepConflictError(
			`.intent/${key} doesn't belong to "${scope.testTitle}". Two test ` +
				"titles may have sanitized to the same folder, or its header was edited.",
		);
	}
	return header.intent === intent ? source : null;
}

async function importStep(file: string): Promise<StepFunction> {
	return (await import(pathToFileURL(file).href)).default as StepFunction;
}

/** Returns the code that ended up doing the step. */
async function replayStep(
	scope: TestScope,
	context: StepContext,
	key: string,
	intent: string,
	source: string,
	line: number | undefined,
): Promise<string> {
	const code = parseStepCode(source);
	const file = scope.localPath(key);
	await materializeStep(file, source);

	if (!scope.agent) {
		const step = await importStep(file);
		await step(context);
		return code;
	}

	const { actionTimeout } = scope.session;
	const running = {
		key,
		intent,
		code,
		line,
		started: false,
		context,
	};
	scope.currentStep = running;
	context.context.setDefaultTimeout(
		actionTimeout || DIAGNOSED_ACTION_TIMEOUT_MS,
	);

	try {
		const step = await importStep(file);
		running.started = true;
		await step(context);
		return code;
	} catch (error) {
		context.context.setDefaultTimeout(actionTimeout || 0);
		return await handleStepFailure(scope, running, error);
	} finally {
		context.context.setDefaultTimeout(actionTimeout || 0);
		scope.currentStep = null;
	}
}

/** Returns the generated code. */
async function generateStep(
	scope: TestScope,
	context: StepContext,
	key: string,
	intent: string,
	line: number | undefined,
): Promise<string> {
	await scope.checkChange({ type: "generate", intent, key });
	if (!scope.agent) {
		throw new IntentNoAgentError(
			`Generating "${intent}" needs use.intent.model in playwright.config.ts.`,
		);
	}
	const agent = scope.agent;
	const testFile = await readTestFile(scope, line);

	scope.testInfo.setTimeout(scope.testInfo.timeout + scope.limits.timeoutMs);

	const outcome = await test.step(
		"agent: generate",
		() =>
			agent.generate(
				{
					intent,
					testTitle: scope.testTitle,
					testFile,
					variableNames: placeholderNames(intent),
					previousSteps: scope.finishedSteps.map((step) => step.intent),
					limits: scope.limits,
				},
				createAgentSession(context, scope.session),
			),
		{ box: true },
	);

	if (outcome.transcript) {
		await scope.testInfo.attach(`agent: ${intent}`, {
			body: outcome.transcript,
			contentType: "text/plain",
		});
	}

	if (outcome.status === "failed") {
		throw new IntentAgentFailedError(
			`The agent couldn't complete "${intent}": ${outcome.message}`,
		);
	}

	const source = await saveStep(scope, key, intent, outcome.code);
	await recordChange(scope, { kind: "write", key, cause: "generate", source });

	if (scope.delivery) {
		throw new IntentRewindError(
			`Saved .intent/${key}. ${provedOnRetry(scope.delivery)}`,
		);
	}
	if (outcome.page === "dirty") {
		throw new IntentRewindError(
			`Saved .intent/${key}, but the page can't continue from here. ` +
				"A retry, or the next run, will replay it from a clean page.",
		);
	}
	return outcome.code;
}
