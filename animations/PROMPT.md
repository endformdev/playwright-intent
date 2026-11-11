# Prompt: continue the Playwright Intent animations

Use this to pick up the animation work. It says what exists, how it works, what was decided and why, and what comes next.

## Goal

Animations that explain Playwright Intent at a glance. They're one of the most important ways people will understand the project, now and more so later. There are two kinds:

- **The README hero** (`overview`): the most compelling, easiest case, told end to end in about 30 seconds.
- **Per-case scenes** for the docs, each making one flow clear. Wanted next:
  - a step that fails for a real reason, so the agent picks `fail` and the test stays red;
  - a flaky failure;
  - the remote store: `.intent` kept out of Git, downloaded before tests and uploaded after.

## What exists

`animations/` is a private pnpm workspace package. It's in `pnpm-workspace.yaml` and the root `tsconfig.json`, so `pnpm tsc` checks it. Its README covers usage.

- `src/runtime/timeline.ts`: the timeline. Every movement is a paused Web Animation with an absolute start, and a frame is rendered by setting each animation's `currentTime`. Any frame renders on its own, and a render always comes out the same.
- `src/runtime/editor.ts`: `Editor` with tabs, `CodeView` with numbered and highlighted lines, gutter icons, and pieces that can be typed or erased, plus `peek` for a file opened under a line.
- `src/runtime/cards.ts`: `card`, `swap` for states that replace each other in place, `spinner`, `ShopBrowser` with a pointer the agent drives, and `RunList`.
- `src/runtime/scene.ts`: `defineScene`, `chapters` (numbered captions with a segmented progress bar), and `titleCard`.
- `src/runtime/theme.css`: light and dark palettes as variables on `.stage`, using Endform's colours: green `#22AA5B`, yellow `#F5E000`, red `#C94C36`. The fonts, Inter and JetBrains Mono, come from `@fontsource` packages, so renders don't depend on the machine's fonts. The diagram styles (`.node`, `.wire`, `.packet`, `.folder-chip`) are left over from a remote store chapter that was cut, and are there for the remote store scene.
- `src/runtime/player.ts` and `src/player.html`: load a scene. With `?capture`, the page only exposes `window.animation` for the renderer. Without it, there are playback controls.
- `src/server.ts`: serves `src`, stripping TypeScript types with `node:module`'s `stripTypeScriptTypes`, so browser code is plain `.ts` with `.ts` imports. It also serves the fonts and live reload.
- `src/preview.ts`, `src/render.ts`, `src/stills.ts`: the `preview`, `render` and `stills` scripts.
- `src/scenes/overview.ts`: the README hero.

## The overview scene

960×540 CSS pixels, rendered at 2× to 1920×1080. It's about 32 s long, with six chapters:

1. **Describe steps in plain language.** A hand-written test's import changes to `playwright-intent`, `ai` joins the fixtures, and four hand-written lines collapse into `await ai.do("add the cheapest shirt to the cart")`. A marker sweeps over the intent.
2. **The agent writes the step, once.** The agent's pointer drives a small shop: it filters to Shirts (the cheaper cap disappears), sorts by price, and adds the tee. The real step file opens under the `ai.do` line, header included.
3. **It's saved as code you review.** A pull request lists `tests/checkout.spec.ts` and the `.intent/...` file. Ada approves it, and it's merged.
4. **Every run replays it, with no AI.** CI runs #43–#46 pass with "0 model calls", while a green marker runs down the step's gutter.
5. **The app changes, and the step fails.** A commit renames "Add to cart" to "Add to bag". Run #47 times out on the click, and that line turns red.
6. **The agent repairs it, and commits the fix.** The diagnosis picks `repair` over `regenerate` and `fail`, with a note that a really broken app gets `fail`. The line is replaced, the retry passes, and a `github-actions` commit appears with the library's real message: `Update Playwright Intent steps`, then `- repair <path>`.

Then the title card wipes back in. It's also the first frame, so the loop is seamless.

The left editor stays in place the whole time. The right column (x 612, width 328) swaps cards per chapter.

## Rules for scenes

- Everything fills forwards only, so an element's own style is its first frame. `enter`, `fadeIn` and `expand` set that starting style.
- Tweens on one property go in time order, because each starts from whatever the earlier ones left.
- Measure layout at build time, after appending and before anything hides. `expand` and `collapse` measure natural height even inside hidden ancestors. `offsetWithin` uses layout offsets, so the preview's scaling doesn't affect it.
- `type` and `erase` count a tab as two characters, matching `tab-size: 2`.
- Nothing random, and no timers. Use `tl.loop` for spinners.
- Keep code true to the library: the real API, the step file format (`renderStepFile` in `playwright-intent/src/step/step-file.ts`), step paths (`.intent/<test file>/<titles>/<intent>.ts`), and commit messages (`commitMessage` in `playwright-intent/src/github/deliver.ts`). Check them against the source before showing them.
- Don't put `id="scene"` or similar on page elements: named access on `window` once shadowed the renderer's global, which is why it's called `window.animation`.

## Rendering, and why it's set up this way

- On GitHub, a README can't autoplay a `.webm`; it only gets a player with controls. So the README uses an animated WebP, which loops on its own, and the WebM is for sites that can use `<video autoplay loop muted>`.
- The README embeds both themes with `<picture>` and `prefers-color-scheme`.
- WebP frames are lossless, at 24 fps. For these flat-colour UI frames, lossless was about as small as lossy, much sharper, and roughly 40× faster to encode (seconds rather than minutes).
- Runs of identical frames merge into one longer frame. The renderer rounds the running total of delays, so the length stays exact.
- Size comes from change, not length. A fade changes every pixel of what's fading on every frame, while a wipe, a cut or a small marker only changes a strip. These changes took the hero from 8.7 MB to about 3.5 MB per theme:
  - the title card wipes instead of fading;
  - tabs switch instantly;
  - the step's lines appear one per frame;
  - the run marker is a gutter bar rather than a transparent band over the code;
  - progress segments fill at the start of each chapter, not continuously.

  Keep the hero around 3–4 MB per theme.

- A full render of both themes takes about 2.5 minutes, mostly screenshots. Check changes with `pnpm --filter @playwright-intent/animations stills <seconds…>` before rendering everything.

## Decisions from Oliver

- The hero shows only the local case, and ends once the fix is committed. The remote store gets its own video later.
- The rendered `overview` WebPs and the README embed live on main. This package stays on the `animations` branch for now.

## Ideas for the next scenes

- **Real failure:** reuse the shop and runs. The app genuinely breaks: checkout errors, or the cart stays at 0. The diagnosis picks `fail` and gives its reason, the test stays red, and nothing is committed. If showing `propose()`, use the comment's real wording from `playwright-intent/src/github/comment.ts`.
- **Flaky:** a failure that passes on retry without the step changing. Check `docs/design.md` for how diagnosis and retries treat it before storyboarding, so the scene matches the library.
- **Remote store:** follow the README section "Sharing steps through a remote store":
  - the config changes from `fileStore` to `remoteStore({ url, token, updates: shared() })`;
  - `.intent` moves to `.gitignore`;
  - the reporter downloads steps before tests and uploads changes from passing tests;
  - CI runs share steps through `@playwright-intent/cache-api` on S3 or R2.
