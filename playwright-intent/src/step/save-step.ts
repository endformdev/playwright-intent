import type { TestScope } from "../fixture/test-scope";
import { materializeStep } from "../store/file-store";
import { renderStepFile } from "./step-file";

export async function saveStep(
	scope: TestScope,
	key: string,
	intent: string,
	code: string,
): Promise<void> {
	const source = renderStepFile({ intent, test: scope.testTitle, code });
	await scope.store.put(key, source);
	await materializeStep(scope.localPath(key), source);
}
