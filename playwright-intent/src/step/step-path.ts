import path from "node:path";

export const INTENT_DIRECTORY = ".intent";

const MAX_SEGMENT_BYTES = 150;
const STEP_EXTENSION = ".ts";
const TITLE_SEPARATOR = " - ";

const UNSAFE_CHARACTERS = /[<>:"/\\|?*\p{Cc}]+/gu;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

export interface StepIdentity {
	/** The test file, relative to the Playwright config. */
	testFile: string;
	/** Describe titles followed by the test title. */
	titles: string[];
	/** The intent template, with placeholders left in. */
	intent: string;
}

/** Where relative paths start: beside the Playwright config. */
export function configDirectory(config: {
	configFile?: string;
	rootDir: string;
}): string {
	return config.configFile ? path.dirname(config.configFile) : config.rootDir;
}

/**
 * The store key for a step. It's a literal translation of where the call is:
 * `tests/cart.spec.ts/cart - guest checkout/fill out the checkout.ts`
 */
export function stepKey({ testFile, titles, intent }: StepIdentity): string {
	const fileSegments = testFile
		.split(/[\\/]/)
		.map((segment) => (segment === ".." ? "__" : segment));

	return [
		...fileSegments,
		sanitizeSegment(titles.join(TITLE_SEPARATOR)),
		`${sanitizeSegment(intent)}${STEP_EXTENSION}`,
	].join("/");
}

/** Deterministic across macOS, Linux and Windows filesystems. */
export function sanitizeSegment(text: string): string {
	const sanitized = cutToBytes(
		text
			.normalize("NFC")
			.toLowerCase()
			.replace(UNSAFE_CHARACTERS, "-")
			.replace(/\s+/g, " ")
			.trim(),
		MAX_SEGMENT_BYTES,
	).replace(/[. ]+$/, "");

	if (!sanitized) return "_";
	return WINDOWS_RESERVED_NAME.test(sanitized) ? `_${sanitized}` : sanitized;
}

function cutToBytes(text: string, maxBytes: number): string {
	let bytes = 0;
	let cut = "";
	for (const character of text) {
		bytes += Buffer.byteLength(character);
		if (bytes > maxBytes) break;
		cut += character;
	}
	return cut;
}
