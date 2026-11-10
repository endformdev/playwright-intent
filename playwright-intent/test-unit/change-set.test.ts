import { expect, test } from "vitest";
import {
	type AttemptChanges,
	buildChangeSet,
} from "../src/reporter/change-set";
import {
	type ChangeRecord,
	parseChangeRecord,
} from "../src/store/change-record";

const write = (key: string, reason?: string): ChangeRecord => ({
	version: 2,
	kind: "write",
	key,
	cause: "repair",
	source: "abc",
	...(reason && { reason }),
});
const failed = (...records: ChangeRecord[]): AttemptChanges => ({
	passed: false,
	records,
});
const passed: AttemptChanges = { passed: true, records: [] };

test("a change is kept when a later attempt passes", () => {
	const set = buildChangeSet([
		{ title: "a", attempts: [failed(write("a.ts", "Renamed")), passed] },
	]);

	expect(set.passed).toEqual([
		{
			key: "a.ts",
			kind: "write",
			cause: "repair",
			reason: "Renamed",
			source: "abc",
			tests: ["a"],
		},
	]);
	expect(set.failed).toEqual([]);
});

test("a change from a test that never passed is left out", () => {
	const set = buildChangeSet([
		{ title: "a", attempts: [failed(write("a.ts")), failed()] },
	]);

	expect(set.passed).toEqual([]);
	expect(set.failed.map((change) => change.key)).toEqual(["a.ts"]);
});

test("an attempt that passes with its own change keeps it", () => {
	const set = buildChangeSet([
		{ title: "a", attempts: [{ passed: true, records: [write("a.ts")] }] },
	]);

	expect(set.passed.map((change) => change.key)).toEqual(["a.ts"]);
	expect(set.failed).toEqual([]);
});

test("a file a failed test also wrote can't be trusted", () => {
	const set = buildChangeSet([
		{ title: "chromium", attempts: [failed(write("a.ts")), passed] },
		{ title: "firefox", attempts: [failed(write("a.ts")), failed()] },
	]);

	expect(set.passed).toEqual([]);
	expect(set.failed.map((change) => change.tests)).toEqual([["firefox"]]);
});

test("tests that pass with the same file are listed together", () => {
	const attempts = [failed(write("a.ts")), passed];

	const set = buildChangeSet([
		{ title: "chromium", attempts },
		{ title: "firefox", attempts },
	]);

	expect(set.passed.map((change) => change.tests)).toEqual([
		["chromium", "firefox"],
	]);
});

test("a regenerated step keeps the reason it was deleted", () => {
	const remove: ChangeRecord = {
		version: 2,
		kind: "delete",
		key: "a.ts",
		cause: "regenerate",
		reason: "Stale",
	};
	const generate: ChangeRecord = {
		version: 2,
		kind: "write",
		key: "a.ts",
		cause: "generate",
		source: "def",
	};

	const set = buildChangeSet([
		{ title: "a", attempts: [failed(remove), failed(generate), passed] },
	]);

	expect(set.passed).toMatchObject([
		{ key: "a.ts", kind: "write", cause: "regenerate", reason: "Stale" },
	]);
});

test("only a test's latest diagnosis is kept", () => {
	const diagnosis = (reason: string): ChangeRecord => ({
		version: 2,
		kind: "diagnosis",
		reason,
	});

	const set = buildChangeSet([
		{
			title: "a",
			attempts: [
				failed(diagnosis("Payment failed")),
				failed(diagnosis("Payments are down")),
			],
		},
	]);

	expect(set.passed).toEqual([]);
	expect(set.diagnoses).toEqual([{ test: "a", reason: "Payments are down" }]);
});

test.each([
	"../outside.ts",
	"a/../../outside.ts",
	"/etc/passwd",
	"C:/windows/system.ts",
	"a\\..\\b.ts",
	"",
])("a record for %j is rejected", (key) => {
	expect(parseChangeRecord(JSON.stringify(write(key)))).toBeNull();
});

test("records from another version or that aren't JSON are rejected", () => {
	expect(
		parseChangeRecord(JSON.stringify({ ...write("a.ts"), version: 1 })),
	).toBeNull();
	expect(parseChangeRecord("not json")).toBeNull();
	expect(parseChangeRecord("null")).toBeNull();
});
