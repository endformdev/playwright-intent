# playwright-intent

Write Playwright steps in plain language. An agent turns each one into TypeScript once, and every later run replays that code like any other Playwright test.

```ts
import { test } from "playwright-intent";

test("checkout", async ({ page, ai }) => {
	await page.goto("/shop");
	await ai.do("add the cheapest shirt to the cart");
	await ai.do("check out as {email}", { email: "ada@example.com" });
});
```

## How it works

- **Intent:** the text you pass to `ai.do`. Use `{name}` for anything that varies, and pass the values as the second argument.
- **Step:** the TypeScript generated for an intent, saved as a file you can read and review. Changing an intent generates a new step.
- **Agent:** explores the live page and writes the step. It sees your test file, but not the values you pass to `ai.do`.
- **Mode:** decides when the agent may run.
- **Store:** where steps live, and what happens when they change.

## Quick start

Requires Node 24 and Playwright 1.60 or later.

```bash
npm install -D playwright-intent
```

```ts
// playwright.config.ts
import {
	defineConfig,
	fail,
	fileStore,
	type IntentUseOptions,
	keep,
} from "playwright-intent";

export default defineConfig<IntentUseOptions>({
	use: {
		intent: {
			model: "openai/gpt-6-luna",
			store: fileStore({
				onChange: { local: keep(), ci: fail() },
			}),
		},
	},
});
```

Run your tests as usual, with `AI_GATEWAY_API_KEY` set or a provider's model in `model`. Then commit the new `.intent` folder.

## Configuration

Everything lives under `use.intent` in `playwright.config.ts`.

| Option    | Description                                                   |
| --------- | ------------------------------------------------------------- |
| `store`   | Required. Where steps live, and what happens when they change |
| `model`   | The [AI SDK](https://ai-sdk.dev) model used to write steps    |
| `mode`    | When the agent may run. Defaults to `missing`                 |
| `agent`   | Replaces the built-in agent                                   |
| `context` | Adds your own text to a failure diagnosis                     |
| `limits`  | The agent's `maxTurns` and `timeoutMs`                        |

## Modes

The `PW_INTENT` environment variable overrides `mode` for one run.

| Mode      | Missing step | Saved step fails |
| --------- | ------------ | ---------------- |
| `none`    | Fails        | Fails            |
| `missing` | Generates    | Fails            |
| `changed` | Generates    | Agent diagnoses  |
| `all`     | Regenerates  | Agent diagnoses  |

## Stores and changes

`fileStore` keeps steps in `.intent` beside your Playwright config.

A store always needs `onChange`, because a change that nobody keeps is lost. A step generated on a CI machine disappears with it, unless you've decided what should happen. `onChange` runs before the agent starts:

- `keep()` lets the change happen, and leaves it on disk for you to review and commit.
- `fail()` fails the test instead, without calling the model.

Pass one function to use it everywhere, or `{ local, ci }` to choose by whether the `CI` environment variable is set:

```ts
fileStore({ onChange: { local: keep(), ci: fail() } });
fileStore({ onChange: keep() });
```

## Status

This is early, and the API may change. See [docs/design.md](docs/design.md) for how it works, and [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and releasing.
