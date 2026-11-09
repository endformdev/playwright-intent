import type { TestScope } from "../fixture/test-scope";
import { materializeStep } from "../store/local-files";
import { renderStepFile } from "./step-file";

export async function saveStep(
	scope: TestScope,
	key: string,
	intent: string,
	code: string,
): Promise<string> {
	const source = renderStepFile({ intent, test: scope.testTitle, code });
	await scope.store.put(key, source);
	await materializeStep(scope.localPath(key), source);
	return source;
}
