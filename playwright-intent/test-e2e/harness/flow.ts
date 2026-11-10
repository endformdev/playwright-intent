import { test as base } from "@playwright/test";
import path from "node:path";
import { WORKSPACES } from "../global-setup";
import { LocalCacheApi } from "./cache-api";
import { FakeGitHub } from "./fake-github";
import { Project } from "./project";

export { expect } from "@playwright/test";

export interface FlowFixtures {
	/** An ESM project with the default store. */
	project: Project;
	github: FakeGitHub;
	/** A local `@playwright-intent/cache-api`, for projects with a remote store. */
	cacheApi: LocalCacheApi;
	/** For the rare flow that needs a differently set up project. */
	createProject(options: {
		moduleType?: "esm" | "cjs";
		cacheApi?: LocalCacheApi;
	}): Promise<Project>;
}

/** A sequence of real Playwright runs against one workspace. */
export const flow = base.extend<FlowFixtures>({
	// Playwright requires an object pattern here, even an empty one.
	// oxlint-disable-next-line no-empty-pattern
	createProject: async ({}, use, testInfo) => {
		const created: Project[] = [];

		await use(async (options) => {
			const project = await Project.create({
				...options,
				id: `${testInfo.testId}-${created.length}`,
			});
			created.push(project);
			return project;
		});

		// Failed flows keep their workspace, so they can be inspected by hand.
		if (testInfo.status === testInfo.expectedStatus) {
			await Promise.all(created.map((project) => project.cleanUp()));
		}
	},

	// oxlint-disable-next-line no-empty-pattern
	github: async ({}, use) => {
		const github = await FakeGitHub.start();
		await use(github);
		await github.close();
	},

	// oxlint-disable-next-line no-empty-pattern
	cacheApi: async ({}, use, testInfo) => {
		const directory = path.join(WORKSPACES, `${testInfo.testId}-cache`);
		const cacheApi = await LocalCacheApi.start(directory);
		await use(cacheApi);
		await cacheApi.close();
		if (testInfo.status === testInfo.expectedStatus) await cacheApi.cleanUp();
	},

	project: async ({ createProject }, use) => {
		await use(await createProject({}));
	},
});
