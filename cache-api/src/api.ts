/** Every endpoint the API serves is under this path. */
export const ZIPS_PATH = "/v1/zips/**";

/** Where main's zip is stored, before `resolvePath`. */
export const MAIN_ZIP = "main.zip";

/**
 * Where a branch's zip is stored, before `resolvePath`. Branch names can hold
 * any character, so they're base64url encoded into one path segment.
 */
export function branchZip(branch: string): string {
	return `branches/${base64url(branch)}.zip`;
}

/** Works in Workers without Node's `Buffer`. */
function base64url(text: string): string {
	let binary = "";
	for (const byte of new TextEncoder().encode(text)) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}
