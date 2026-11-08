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
	version: 1,
	kind: "write",
	key,
	cause: "repair",
	source: "abc",
	delivery: "commit",
	...(reason && { reason }),
});
const failed = (...records: ChangeRecord[]): AttemptChanges => ({
	passed: false,
	records,
});
const passed: AttemptChanges = { passed: true, records: [] };

test("a change is proven by a later attempt that passes", () => {
	const set = buildChangeSet([
		{ title: "a", attempts: [failed(write("a.ts", "Renamed")), passed] },
	]);

	expect(set.proven).toEqual([
		{
			key: "a.ts",
			kind: "write",
			cause: "repair",
			reason: "Renamed",
			source: "abc",
			delivery: "commit",
			tests: ["a"],
		},
	]);
	expect(set.unproven).toEqual([]);
});

test("a change from a test that never passed is unproven", () => {
	const set = buildChangeSet([
		{ title: "a", attempts: [failed(write("a.ts")), failed()] },
	]);

	expect(set.proven).toEqual([]);
	expect(set.unproven.map((change) => change.key)).toEqual(["a.ts"]);
});

test("an attempt that passes after rewriting proves nothing", () => {
	const set = buildChangeSet([
		{
			title: "a",
			attempts: [
				failed(write("a.ts")),
				{ passed: true, records: [write("a.ts")] },
			],
		},
	]);

	expect(set.proven).toEqual([]);
	expect(set.unproven.map((change) => change.key)).toEqual(["a.ts"]);
});

test("a file a failed test also wrote can't be trusted", () => {
	const set = buildChangeSet([
		{ title: "chromium", attempts: [failed(write("a.ts")), passed] },
		{ title: "firefox", attempts: [failed(write("a.ts")), failed()] },
	]);

	expect(set.proven).toEqual([]);
	expect(set.unproven.map((change) => change.tests)).toEqual([["firefox"]]);
});

test("tests that prove the same file are listed together", () => {
	const attempts = [failed(write("a.ts")), passed];

	const set = buildChangeSet([
		{ title: "chromium", attempts },
		{ title: "firefox", attempts },
	]);

	expect(set.proven.map((change) => change.tests)).toEqual([
		["chromium", "firefox"],
	]);
});

test("a regenerated step keeps the reason it was deleted", () => {
	const remove: ChangeRecord = {
		version: 1,
		kind: "delete",
		key: "a.ts",
		cause: "regenerate",
		reason: "Stale",
		delivery: "commit",
	};
	const generate: ChangeRecord = {
		version: 1,
		kind: "write",
		key: "a.ts",
		cause: "generate",
		source: "def",
		delivery: "commit",
	};

	const set = buildChangeSet([
		{ title: "a", attempts: [failed(remove), failed(generate), passed] },
	]);

	expect(set.proven).toMatchObject([
		{ key: "a.ts", kind: "write", cause: "regenerate", reason: "Stale" },
	]);
});

test("only a test's latest diagnosis is kept", () => {
	const diagnosis = (reason: string): ChangeRecord => ({
		version: 1,
		kind: "diagnosis",
		reason,
		delivery: "commit",
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

	expect(set.proven).toEqual([]);
	expect(set.diagnoses).toEqual([
		{ test: "a", reason: "Payments are down", delivery: "commit" },
	]);
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
		parseChangeRecord(JSON.stringify({ ...write("a.ts"), version: 2 })),
	).toBeNull();
	expect(parseChangeRecord("not json")).toBeNull();
	expect(parseChangeRecord("null")).toBeNull();
});
