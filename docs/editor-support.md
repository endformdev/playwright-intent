---
title: Editor support
description: Jump from an ai.do intent to its step, and see the step's code on hover, in VS Code.
sidebar:
  order: 5
---

Playwright Intent has an extension for VS Code.

The [Playwright Intent extension](../vscode-extension) for VS Code links each `ai.do` to its step. Cmd+click (Ctrl+click) on an intent opens its step, and hovering over the intent or its `do` shows the step's code.

To suggest it to everyone who opens your repository, add it to `.vscode/extensions.json`:

```json
{ "recommendations": ["endform.playwright-intent-vscode"] }
```

If the repository has a `.vscode` folder, [`playwright-intent init`](setup.md) reminds you to add it.

The extension finds a step from the titles of the `test` and `test.describe` calls around it. When those aren't string literals, as in a loop, or when `ai.do` is called from a helper, it offers every step with the same intent instead. Steps from a remote store show up once a run has downloaded them to `.intent`.
