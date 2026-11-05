import type { TestScope } from "../fixture/test-scope";

/** Why a step was moved aside. Retries are new processes, so it's stored. */
export interface FailedStep {
	intent: string;
	code: string;
	error: string;
}

const failedKey = (key: string) => `.failed/${key}.json`;

export async function moveStepAside(
	scope: TestScope,
	key: string,
	failed: FailedStep,
): Promise<void> {
	await scope.store.put(failedKey(key), JSON.stringify(failed, null, "\t"));
	await scope.store.delete(key);
}

export async function readFailedStep(
	scope: TestScope,
	key: string,
): Promise<FailedStep | null> {
	const record = await scope.store.get(failedKey(key));
	return record === null ? null : (JSON.parse(record) as FailedStep);
}

export async function clearFailedStep(
	scope: TestScope,
	key: string,
): Promise<void> {
	await scope.store.delete(failedKey(key));
}
