<h1 align="center">Playwright Intent</h1>

<p align="center">
	<strong>Plain-language Playwright steps, saved as code you can review.</strong>
</p>

<p align="center">
	<a href="https://www.npmjs.com/package/playwright-intent"><img src="https://img.shields.io/npm/v/playwright-intent" alt="npm version" /></a>
	<a href="LICENSE"><img src="https://img.shields.io/npm/l/playwright-intent" alt="license" /></a>
</p>

---

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
| `prompts` | Changes what the built-in agent is told                       |
| `context` | Adds your own text to a failure diagnosis                     |
| `limits`  | The agent's `maxTurns` and `timeoutMs`                        |

## Models

`model` takes any [AI SDK](https://ai-sdk.dev) model that supports tool calling. A string goes through Vercel AI Gateway. To use anything else, install its provider and pass the model:

```ts
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const openrouter = createOpenRouter({
	apiKey: process.env.OPENROUTER_API_KEY,
});

// In use.intent:
model: openrouter.chat("openai/gpt-6-luna"),
```

For LiteLLM, Ollama, or a company proxy, use an OpenAI-compatible provider:

```ts
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const proxy = createOpenAICompatible({
	name: "proxy",
	baseURL: "http://localhost:4000/v1",
	apiKey: process.env.PROXY_API_KEY,
});

// In use.intent:
model: proxy("gpt-6-luna"),
```

Providers that wrap a CLI, like Codex CLI or Claude Code, run their own tools instead of ours, so they won't work.

So far, generated steps have only been tried with `openai/gpt-6-luna`.

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

## Prompts

The built-in agent has two prompts: `generate` writes new steps, and `diagnose` decides what to do after a failure. You can [read them here](playwright-intent/src/agent/prompts.ts), or import them as `defaultPrompts`.

Build on a prompt to teach the agent about your app, and you'll keep getting improvements to the default:

```ts
import { defaultPrompts } from "playwright-intent";

// In use.intent
prompts: {
	generate: `${defaultPrompts.generate}

Dropdowns in this app only open after their label is clicked.`,
},
```

Or pass your own text to replace a prompt completely. The agent's tools stay the same and explain how to use them, so a prompt only needs to say what good work looks like.

Changing a prompt doesn't change steps you've already saved. `PW_INTENT=all` regenerates them, so keep them in Git first.

## Project status

This is early, and the API may change. See [docs/design.md](docs/design.md) for how it works.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and releasing.

## License

[Apache-2.0](LICENSE).

Playwright is a trademark of its respective owner. This project is not affiliated with or endorsed by the Playwright project.

---

<p align="center">Built by</p>
<p align="center">
	<a href="https://endform.dev">
		<picture>
			<source media="(prefers-color-scheme: dark)" srcset="docs/assets/endform-logo-dark.svg" />
			<img src="docs/assets/endform-logo.svg" height="24" alt="Endform" />
		</picture>
	</a>
</p>
