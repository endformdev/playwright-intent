# Playwright Intent for VS Code

Go from an `ai.do` intent to the step it runs, without leaving your test.

[Playwright Intent](https://github.com/endformdev/playwright-intent) lets you
write Playwright steps in plain language. An agent turns each intent into
TypeScript once and saves it in `.intent`, and every later run replays that
code. This extension connects the two, so the intent in your test leads straight
to the code it runs.

```ts
test("checkout", async ({ page, ai }) => {
	await page.goto("/shop");
	await ai.do("add the cheapest shirt to the cart");
	//          ^ Cmd+click to open the step, or hover to read it
});
```

## Features

- **Go to step:** Cmd+click (Ctrl+click on Windows and Linux) on an intent, or
  use **Go to Definition**, to open its step at the first line of code.
- **Step preview:** hover over an intent, or over its `do`, to see the step's
  code and a link to its file.
- **Missing steps:** the hover tells you when an intent has no step yet. The
  agent writes it on the next run.

## How steps are found

A step's path comes from where its `ai.do` is: the test file, then the
`test.describe` and `test` titles, then the intent. The extension reads those
from your code and opens that file in the nearest `.intent` folder.

When the titles aren't string literals, as in a loop, or when `ai.do` is called
from a helper or a hook, only a test run knows the path. The extension then
offers the steps with the same intent, keeping to the current test file when it
has any.

With a remote store, steps show up once a test run has downloaded them to
`.intent`.

## Requirements

- [playwright-intent](https://www.npmjs.com/package/playwright-intent) 0.2.0 or
  later. Earlier versions named step files differently.
- Steps saved in a `.intent` folder, which is where both of its stores keep
  them.

## Recommend it to your team

Add the extension to `.vscode/extensions.json`, and VS Code suggests it to
everyone who opens the repository:

```json
{ "recommendations": ["endform.playwright-intent-vscode"] }
```

## Links

- [Playwright Intent documentation](https://github.com/endformdev/playwright-intent#readme)
- [Report an issue](https://github.com/endformdev/playwright-intent/issues)
- [Apache-2.0 license](https://github.com/endformdev/playwright-intent/blob/main/LICENSE)

Playwright is a trademark of its respective owner. This project is not
affiliated with or endorsed by the Playwright project.

---

Built by [Endform](https://endform.dev).
