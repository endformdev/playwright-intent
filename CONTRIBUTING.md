# Contributing to playwright-intent

## Prerequisites

- Node.js 24
- [pnpm](https://pnpm.io) (see `packageManager` in `package.json` for the exact version)

## Setup

```bash
git clone https://github.com/endformdev/playwright-intent.git
cd playwright-intent
pnpm install
```

## Repository layout

This is a pnpm workspace. Each package lives in a top-level directory:

- `playwright-intent/` — the `playwright-intent` package

Additional packages are published under the `@playwright-intent/` npm scope. To add one, create a top-level directory, add it to `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`, the `release` script in `package.json` and the filters in `.github/workflows/release.yml`.

## Root-level commands

- `pnpm test` runs the unit tests (vitest)
- `pnpm tsc` typechecks all packages
- `pnpm format` formats files with oxfmt
- `pnpm lint` lints with oxlint
- `pnpm build` builds all packages

## Releasing

```bash
pnpm release
```

This bumps all packages to the same version, commits, tags, and pushes to trigger the publish workflow, which publishes to npm via trusted publishing.

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 license](LICENSE).
