import fs from "node:fs/promises";
import path from "node:path";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
export const WORKSPACES = path.join(PACKAGE_ROOT, "test-e2e", ".workspaces");

/**
 * Installs the built package the way npm would: copied into a `node_modules`
 * folder. A symlink wouldn't do, because Playwright hides stack frames from
 * `node_modules`, and that's what points a step at the user's own line.
 */
export default async function globalSetup() {
	const dist = path.join(PACKAGE_ROOT, "dist");
	const built = await fs.stat(dist).catch(() => null);
	if (!built) throw new Error("Run `pnpm build` before the e2e flows.");

	await fs.rm(WORKSPACES, { recursive: true, force: true });
	const installed = path.join(WORKSPACES, "node_modules", "playwright-intent");
	await fs.mkdir(installed, { recursive: true });
	await fs.cp(dist, path.join(installed, "dist"), { recursive: true });
	await fs.copyFile(
		path.join(PACKAGE_ROOT, "package.json"),
		path.join(installed, "package.json"),
	);
}
