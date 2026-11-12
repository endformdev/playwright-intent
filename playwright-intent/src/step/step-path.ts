import path from "node:path";

export const INTENT_DIRECTORY = ".intent";

/** Keeps whole paths under Windows' 260 character limit. */
const MAX_NAME_CHARACTERS = 64;
/** Some Linux filesystems allow fewer than 255 bytes per name. */
const MAX_NAME_BYTES = 150;
const STEP_EXTENSION = ".ts";
/** Unambiguous, because runs of `-` inside a name collapse to one. */
const TITLE_SEPARATOR = "--";

const APOSTROPHES = /['’]/g;
/** Everything but letters, digits, `.` and `_`, including spaces. */
const UNSAFE_CHARACTERS = /[^\p{L}\p{M}\p{N}._]+/gu;
const EDGE_PUNCTUATION = /^[-._]+|[-._]+$/g;
/** Windows reserves these even with an extension, like `con.ts`. */
const WINDOWS_RESERVED_NAME =
	/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/;

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
 * `tests/cart.spec.ts/cart--guest-checkout/fill-out-the-checkout.ts`
 */
export function stepKey({ testFile, titles, intent }: StepIdentity): string {
	return [
		...testFile.split(/[\\/]/).map(slugify),
		titles.map(slugify).join(TITLE_SEPARATOR),
		`${slugify(intent)}${STEP_EXTENSION}`,
	].join("/");
}

/**
 * A file or folder name that's the same on macOS, Linux and Windows, and that
 * needs no quoting in shells, globs, `.gitignore` or URLs.
 */
export function slugify(text: string): string {
	const slug = cut(
		text
			.normalize("NFC")
			.toLowerCase()
			.replace(APOSTROPHES, "")
			.replace(UNSAFE_CHARACTERS, "-")
			.replace(EDGE_PUNCTUATION, ""),
	).replace(EDGE_PUNCTUATION, "");

	if (!slug) return "_";
	return WINDOWS_RESERVED_NAME.test(slug) ? `_${slug}` : slug;
}

/** Cuts to the name limits without splitting a character. */
function cut(text: string): string {
	let characters = 0;
	let bytes = 0;
	let result = "";
	for (const character of text) {
		characters += 1;
		bytes += Buffer.byteLength(character);
		if (characters > MAX_NAME_CHARACTERS || bytes > MAX_NAME_BYTES) break;
		result += character;
	}
	return result;
}
