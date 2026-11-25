import { createInterface } from "node:readline/promises";

/** Stops `init` before anything is written, with a message for the user. */
export class InitStop extends Error {}

/** Questions for a person at a terminal. Agents and scripts never get these. */
export interface Prompts {
	/** Returns `initial` when the answer is empty. */
	text(message: string, initial: string): Promise<string>;
	/** Yes unless the answer starts with n. */
	confirm(message: string): Promise<boolean>;
	select(message: string, options: string[]): Promise<string>;
}

export const terminalPrompts: Prompts = {
	async text(message, initial) {
		const answer = await ask(`${message} (${initial}) `);
		return answer || initial;
	},
	async confirm(message) {
		const answer = await ask(`${message} (Y/n) `);
		return !answer.toLowerCase().startsWith("n");
	},
	async select(message, options) {
		const list = options
			.map((option, index) => `  ${index + 1}. ${option}`)
			.join("\n");
		while (true) {
			const answer = await ask(`${message}\n${list}\nNumber: `);
			const chosen = options[Number.parseInt(answer, 10) - 1];
			if (chosen) return chosen;
		}
	},
};

async function ask(question: string): Promise<string> {
	const readline = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	const cancel = new AbortController();
	readline.on("SIGINT", () => cancel.abort());
	readline.on("close", () => cancel.abort());
	try {
		return (
			await readline.question(question, { signal: cancel.signal })
		).trim();
	} catch {
		process.stdout.write("\n");
		throw new InitStop("Cancelled. Nothing was changed.");
	} finally {
		readline.close();
	}
}
