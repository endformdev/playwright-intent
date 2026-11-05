import { expect, test } from "vitest";
import { IntentVariablesError } from "../src/errors";
import {
	assertVariablesMatch,
	placeholderNames,
} from "../src/step/intent-text";

test("finds each placeholder once", () => {
	expect(placeholderNames("send {email} to {name} and {email}")).toEqual([
		"email",
		"name",
	]);
});

test("accepts matching placeholders and values", () => {
	expect(() =>
		assertVariablesMatch("sign up as {email}", { email: "a@b.c" }),
	).not.toThrow();
});

test("rejects a placeholder without a value", () => {
	expect(() => assertVariablesMatch("sign up as {email}", {})).toThrow(
		IntentVariablesError,
	);
});

test("rejects a value without a placeholder", () => {
	expect(() => assertVariablesMatch("sign up", { email: "a@b.c" })).toThrow(
		IntentVariablesError,
	);
});

test("rejects an empty intent", () => {
	expect(() => assertVariablesMatch("  ", {})).toThrow(IntentVariablesError);
});
