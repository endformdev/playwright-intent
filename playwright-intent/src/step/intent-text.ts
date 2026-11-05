import { IntentVariablesError } from "../errors";

export type StepVariables = Record<string, string>;

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function placeholderNames(intent: string): string[] {
	const names = [...intent.matchAll(PLACEHOLDER)].map((match) => match[1]!);
	return [...new Set(names)];
}

/** Every placeholder needs a value, and every value needs a placeholder. */
export function assertVariablesMatch(
	intent: string,
	vars: StepVariables,
): void {
	if (!intent.trim()) {
		throw new IntentVariablesError("ai.do needs a non-empty intent.");
	}

	const placeholders = placeholderNames(intent);
	const missing = placeholders.filter((name) => !(name in vars));
	const unused = Object.keys(vars).filter(
		(name) => !placeholders.includes(name),
	);

	if (missing.length > 0) {
		throw new IntentVariablesError(
			`Intent "${intent}" has no value for: ${missing.join(", ")}.`,
		);
	}
	if (unused.length > 0) {
		throw new IntentVariablesError(
			`Intent "${intent}" has no placeholder for: ${unused.join(", ")}. ` +
				`Add {${unused[0]}} to the intent, or stop passing it.`,
		);
	}
}
