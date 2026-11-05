import fs from "node:fs";
import type {
	AgentSession,
	DiagnoseTask,
	FailureDecision,
	GenerateOutcome,
	GenerateTask,
	IntentAgent,
} from "playwright-intent";

export interface ScriptedGeneration {
	/** Code to run through the session before finishing. */
	explore?: string[];
	outcome: GenerateOutcome;
}

export interface ScriptedDiagnosis {
	explore?: string[];
	decision: FailureDecision;
}

/** Answers per intent, in call order. Keyed by `outside` for test failures. */
export interface AgentScript {
	generate?: Record<string, ScriptedGeneration[]>;
	diagnose?: Record<string, ScriptedDiagnosis[]>;
}

export interface AgentCall {
	kind: "generate" | "diagnose";
	intent: string;
	task: GenerateTask | DiagnoseTask;
	logs: string[];
	unscripted?: boolean;
}

export const AGENT_CALLS_FILE = "agent-calls.jsonl";

function readCalls(): AgentCall[] {
	if (!fs.existsSync(AGENT_CALLS_FILE)) return [];
	return fs
		.readFileSync(AGENT_CALLS_FILE, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as AgentCall);
}

function record(call: AgentCall) {
	fs.appendFileSync(AGENT_CALLS_FILE, `${JSON.stringify(call)}\n`);
}

function readScript(): AgentScript {
	const file = process.env.INTENT_E2E_AGENT_SCRIPT;
	if (!file) return {};
	return JSON.parse(fs.readFileSync(file, "utf8")) as AgentScript;
}

async function explore(session: AgentSession, code: string[] = []) {
	const logs: string[] = [];
	for (const snippet of code) {
		const result = await session.run(snippet);
		logs.push(...result.logs);
		if (!result.ok) {
			throw new Error(`Scripted exploration failed: ${result.error}`);
		}
	}
	return logs;
}

/**
 * Replaces the model at the `IntentAgent` boundary, so everything else in a
 * flow is real. Calls are logged to a file because a retry is a new process.
 */
export function createScriptedAgent(): IntentAgent {
	const nextIndex = (kind: AgentCall["kind"], intent: string) =>
		readCalls().filter((call) => call.kind === kind && call.intent === intent)
			.length;

	return {
		async generate(task, session) {
			const intent = task.intent;
			const scripted =
				readScript().generate?.[intent]?.[nextIndex("generate", intent)];
			if (!scripted) {
				record({ kind: "generate", intent, task, logs: [], unscripted: true });
				throw new Error(`Unscripted agent call: generate "${intent}"`);
			}
			const logs = await explore(session, scripted.explore);
			record({ kind: "generate", intent, task, logs });
			return scripted.outcome;
		},

		async diagnose(task, session) {
			const intent = task.location === "outside" ? "outside" : task.intent;
			const scripted =
				readScript().diagnose?.[intent]?.[nextIndex("diagnose", intent)];
			if (!scripted) {
				record({ kind: "diagnose", intent, task, logs: [], unscripted: true });
				throw new Error(`Unscripted agent call: diagnose "${intent}"`);
			}
			const logs = await explore(session, scripted.explore);
			record({ kind: "diagnose", intent, task, logs });
			return scripted.decision;
		},
	};
}
