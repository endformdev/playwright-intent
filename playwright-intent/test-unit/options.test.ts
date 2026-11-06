import { expect, test } from "vitest";
import { IntentError } from "../src/errors";
import { resolveMode } from "../src/options";

test("defaults to missing, in CI too", () => {
	expect(resolveMode(undefined, {})).toBe("missing");
	expect(resolveMode(undefined, { CI: "true" })).toBe("missing");
});

test("prefers PW_INTENT over the config", () => {
	expect(resolveMode("none", { PW_INTENT: "changed" })).toBe("changed");
});

test("rejects unknown modes", () => {
	expect(() => resolveMode(undefined, { PW_INTENT: "nope" })).toThrow(
		IntentError,
	);
});
