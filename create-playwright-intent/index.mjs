#!/usr/bin/env node
// `npm init playwright-intent` runs this. It's `npx playwright-intent init`,
// from the same version, with the same options.
import { runCli } from "playwright-intent/cli";

process.exitCode = await runCli(["init", ...process.argv.slice(2)]);
