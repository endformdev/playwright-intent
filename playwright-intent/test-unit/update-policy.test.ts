import { expect, test } from "vitest";
import { fileStore } from "../src/store/file-store";
import {
	allow,
	commit,
	type FileStoreUpdates,
	fileStoreUpdates,
	propose,
	refuse,
	resolveUpdatePolicy,
	type UpdatePolicy,
} from "../src/store/update-policy";

const pair: FileStoreUpdates = { local: allow(), ci: refuse() };

test("a pair picks by the CI variable", () => {
	expect(resolveUpdatePolicy(pair, {}).name).toBe("allow");
	expect(resolveUpdatePolicy(pair, { CI: "true" }).name).toBe("refuse");
});

test("a single policy applies everywhere", () => {
	expect(resolveUpdatePolicy(allow(), {}).name).toBe("allow");
	expect(resolveUpdatePolicy(allow(), { CI: "true" }).name).toBe("allow");
});

test("only commit and propose are delivered, and only propose awaits review", () => {
	const updates = (policy: () => UpdatePolicy) => {
		const { delivered, awaitsReview, refused } = fileStoreUpdates(policy());
		return { delivered, awaitsReview, refused };
	};

	expect(updates(allow)).toEqual({
		delivered: false,
		awaitsReview: false,
		refused: false,
	});
	expect(updates(refuse)).toEqual({
		delivered: false,
		awaitsReview: false,
		refused: true,
	});
	expect(updates(commit)).toEqual({
		delivered: true,
		awaitsReview: false,
		refused: false,
	});
	expect(updates(propose)).toEqual({
		delivered: true,
		awaitsReview: true,
		refused: false,
	});
});

test("a file store resolves its updates from the environment it's given", () => {
	const store = fileStore({ updates: { local: allow(), ci: commit() } });

	expect(store.updates({}).delivered).toBe(false);
	expect(store.updates({ CI: "true" }).delivered).toBe(true);
});
