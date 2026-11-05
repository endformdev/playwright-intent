export interface StepHeader {
	/** The exact intent. A mismatch means the intent changed: a cache miss. */
	intent: string;
	/** The exact test. A mismatch means two tests collided: a loud error. */
	test: string;
}

export interface StepSource extends StepHeader {
	/** The statements the agent produced. */
	code: string;
}

const HEADER = /^\/\/ intent: (.+)\n\/\/ test: (.+)\n/;

/** Line numbers in this file are what traces and error snippets show. */
export function renderStepFile({ intent, test, code }: StepSource): string {
	const body = code
		.trim()
		.split("\n")
		.map((line) => (line ? `\t${line}` : line))
		.join("\n");

	return `// intent: ${JSON.stringify(intent)}
// test: ${JSON.stringify(test)}
import type { StepContext } from "playwright-intent";

export default async function ({ page, context, request, expect, vars }: StepContext): Promise<void> {
${body}
}
`;
}

export function parseStepHeader(source: string): StepHeader | null {
	const match = HEADER.exec(source);
	if (!match) return null;
	try {
		return {
			intent: JSON.parse(match[1]!) as string,
			test: JSON.parse(match[2]!) as string,
		};
	} catch {
		return null;
	}
}
