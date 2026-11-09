# When passing isn't enough

A green test tells us a step worked once. It doesn't tell us the saved code is any good. Each time we trialled the agent on a real app, its code passed and still had real problems, which only showed up when the code was replayed or read. Prompt rules fixed most of them, but we have no guarantee they'll stay fixed.

This is a note to come back to. Nothing here needs doing yet, but [what to decide](#what-to-decide-later) lists the choices.

## How we got here

All of this ran on `openai/gpt-6-luna` through Vercel AI Gateway, against `../playwright-tutorial`.

| Trial                | What looked fine                       | What was actually wrong                                                                                                              | Found by            |
| -------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| Generating 3 tests   | Generation passed every round          | Replay failed: the avatar was located by the user's initial, like `getByRole('button', { name: 'c' })`, which differs per user       | Replaying           |
| Same                 | Generation passed                      | Replay failed strict mode: a saved `getByText('Plus', { exact: true })` matched 2 elements, and the agent may never have run it      | Replaying           |
| 14 failure scenarios | Every decision was right               | A repair that could have continued took a retry instead: comparing ARIA snapshots called a page "changed" while it was still loading | Reading the results |
| 11 redesign runs     | Every test passed, then replayed twice | Steps with `if` and `.catch`, steps pressing Escape, and steps on one line                                                           | Reading the code    |

The last row is what this note is named for. It was the only trial with no failure to investigate. Every run was green, and the only clue was a repair reason that said billing fields were revealed "conditionally", so we read the code.

### What the redesign code looked like

A step made conditional, so it passes whether or not the button appears:

```ts
if (
	await page
		.getByRole("button", { name: "Continue to billing" })
		.isVisible()
		.catch(() => false)
) {
	await page.getByRole("button", { name: "Continue to billing" }).click();
}
```

A step working around what the failed attempt left behind. The failed step had opened a menu, so the repair closes it. On a fresh replay there's no menu to close, so the second version opens one just to close it:

```ts
await page.getByTestId("user-menu-trigger").click();
await page.keyboard.press("Escape");
await expect(page.getByRole("menu")).toBeHidden();
await page.getByRole("button", { name: "Log off" }).click();
```

### Counts

Measured by `trials/scan_steps.py` on the steps each run changed. The second run is after moving the code rules into one list shared by both prompts, on a fresh baseline.

| Redesign runs    | Changed steps | Conditional | Leftover Escape | Several statements on a line |
| ---------------- | ------------- | ----------- | --------------- | ---------------------------- |
| Before the rules | 23            | 2           | 2               | 3                            |
| After the rules  | 23            | 0           | 1               | 0                            |

The 18 failure scenarios changed 7 more steps after the rules, and none were flagged. Every run in both tables passed, so none of this shows up in pass rates.

The rules that made the difference are in `STEP_CODE_RULES` in `playwright-intent/src/agent/prompts.ts`, plus the repair instruction to write for where the step starts, not for the page in front of the agent. That instruction is now in the `repair` tool's description.

## Why a pass misses this

- **The agent marks its own work.** It generates or repairs code on a live page, so the first pass happens on the same page, with the same user, in the state it set up.
- **Replays only catch what breaks.** A step with `if` keeps passing, which is the problem. A later replay can't tell a good step from one that has quietly stopped checking something.
- **Repairs start from a dirty page.** A failed step may leave a menu open or a form half filled, and it's natural for the agent to write code for what it can see.
- **Instructions aren't enforced.** The agent ignored the rule to use `normalize()`, and it copied a test's `John Doe` assertion into a step despite being told not to. What fixed the avatar was giving it test ids to see, not another rule.

## How to reproduce

You need `../playwright-tutorial` checked out, and `AI_GATEWAY_API_KEY` in your environment with paid credits. Free-tier keys can't use this model. Both trials together cost about $0.09 and take around 25 minutes.

Set up the tutorial, ideally on a throwaway branch. The trial scripts edit its app and put the files back when each scenario ends.

```bash
trials/setup-tutorial.sh
cd ../playwright-tutorial
pnpm dev
```

In a second terminal, create the baseline every scenario starts from:

```bash
cd ../playwright-tutorial
export BASE_URL=http://localhost:3000
rm -rf .intent
./node_modules/.bin/playwright test -c intent.config.ts
ENDFORM=true ./node_modules/.bin/playwright test -c intent.config.ts --repeat-each=3
rm -rf /tmp/intent-baseline && cp -R .intent /tmp/intent-baseline
```

Then run the trials from this repo, and scan what they changed:

```bash
python3 trials/redesign.py /tmp/redesign.jsonl
python3 trials/failures.py /tmp/failures.jsonl
python3 trials/scan_steps.py /tmp/redesign.jsonl /tmp/failures.jsonl
```

Read the code as well as the scan, because the scan only finds patterns we already know about. Each line of the results holds the saved `steps` and the agent's `transcripts`.

To see the problems from before the rules, check out `3f2876e`, which has the earlier prompts, and repeat from `setup-tutorial.sh`. That commit doesn't have the trial scripts, so keep a copy of `trials/` outside the repo first. Results vary between runs, so one run may not show every problem.

## Consequences

- **Pass rates can't be our measure of quality.** Any evaluation has to look at the code too, and the model will need checking again whenever it or the prompts change.
- **Letting the agent change steps can make a suite weaker while it stays green.** That's the failure we most wanted to avoid: a test that adapts to a bug instead of catching it. Conditional steps are the clearest way that can happen.
- **Review matters more than it looks.** Steps live in Git so people can read them, and the run output lists assertion changes, but it won't flag a new `if`.
- **Removing the guardrails is still reasonable, but it now rests on prompt rules alone.** We removed them as premature when we had no evidence of what real code looks like. We have some now: these patterns do appear, and rules reduce them without removing them.
- **Results here are thin.** One app, one model, and each scenario ran a few times. Another model could behave quite differently.

## What to decide later

1. **Should something check saved code?** Warning in the run output is cheaper and less risky than blocking, and could reuse the patterns in `scan_steps.py`. Blocking could trap a legitimate step.
2. **Should a repair be replayed from a clean page before it's trusted?** A `ready` repair currently continues without ever replaying from the step's starting point. Treating every repair as `dirty` would replay it on the retry, at the cost of one retry each.
3. **Should trials become a repeatable evaluation?** They could run across several models before a release, with `scan_steps.py` as part of the score.
4. **Should a person have to accept repairs?** For example, the agent could save repairs for review rather than letting them run straight away.
