---
title: Prompts
description: Build on the built-in agent's prompts to teach it about your app, or replace them.
sidebar:
  order: 4
---

Prompts change what the built-in agent is told.

The built-in agent has two prompts: `generate` writes new steps, and `diagnose` decides what to do after a failure. You can [read them here](../playwright-intent/src/agent/prompts.ts), or import them as `defaultPrompts`.

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

Changing a prompt doesn't change steps you've already saved. Delete them from `.intent` to regenerate them, and keep them in Git first.
