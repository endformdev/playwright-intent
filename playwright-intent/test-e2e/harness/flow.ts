import { test as base } from "@playwright/test";
import { Project } from "./project";

export { expect } from "@playwright/test";

export interface FlowFixtures {
	/** An ESM project with the default store. */
	project: Project;
	/** For the rare flow that needs a differently set up project. */
	createProject(options: {
		moduleType?: "esm" | "cjs";
		remoteStore?: boolean;
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

	project: async ({ createProject }, use) => {
		await use(await createProject({}));
	},
});
