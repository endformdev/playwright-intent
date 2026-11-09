import type { RunChange, RunDiagnosis } from "../reporter/change-set";

export const COMMENT_MARKER = "<!-- playwright-intent -->";

/** GitHub rejects anything over 65536 characters. */
const MAX_COMMENT_LENGTH = 60_000;

export interface ProposalComment {
	sha: string;
	proposals: (RunChange & { path: string })[];
	diagnoses: RunDiagnosis[];
	patch: string;
}

export function renderProposalComment({
	sha,
	proposals,
	diagnoses,
	patch,
}: ProposalComment): string {
	const sections = [COMMENT_MARKER];

	if (proposals.length > 0) {
		sections.push(
			`### Proposed Playwright Intent step fixes\n\nAn automatic fix was found for the following failing Playwright end-to-end tests at commit \`${sha.slice(0, 7)}\`. These changes need applying for the tests to pass.`,
			proposals.map(describeProposal).join("\n"),
		);
		sections.push(applyInstructions(patch));
	}

	if (diagnoses.length > 0) {
		sections.push(
			"### Failures the agent left alone",
			diagnoses
				.map(({ test, reason }) => `- **${plain(test)}**: ${plain(reason)}`)
				.join("\n"),
		);
	}

	return sections.join("\n\n");
}

export function renderSettledComment(sha: string): string {
	return `${COMMENT_MARKER}\n\nNo step fixes to propose as of \`${sha.slice(0, 7)}\`.`;
}

function describeProposal(change: RunChange & { path: string }): string {
	const action = change.kind === "delete" ? "delete" : change.cause;
	const because = change.reason ? `: ${plain(change.reason)}` : "";
	return `- \`${plain(change.path)}\` (${action})${because}`;
}

/** The patch is a heredoc, so copying the block and pasting it applies it. */
function applyInstructions(patch: string): string {
	const script = `git apply <<'INTENT_PATCH'\n${patch}INTENT_PATCH`;
	if (script.length > MAX_COMMENT_LENGTH) {
		return "The patch is too large for a comment. It's printed in this job's log.";
	}
	const longest = Math.max(
		2,
		...[...script.matchAll(/`+/g)].map((match) => match[0].length),
	);
	const fence = "`".repeat(longest + 1);
	return `<details>\n<summary>Apply the fixes with a patch</summary>\n\nRun this from the repository root, then commit the result:\n\n${fence}sh\n${script}\n${fence}\n\n</details>`;
}

/** Reasons are written by the model, so they mustn't ping anyone or add HTML. */
function plain(text: string): string {
	return text
		.replace(/\s+/g, " ")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/@/g, "@​");
}
