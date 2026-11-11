# Animations

The animations in the README and docs. Each one is a scene: a web page built once, with every movement scheduled on a timeline. Playwright screenshots it frame by frame, so a render is the same every time, and the output is an animated WebP that plays inline on GitHub, plus a WebM for pages that can use `<video>`.

```bash
pnpm --filter @playwright-intent/animations preview   # http://localhost:4600
pnpm --filter @playwright-intent/animations render    # every scene, light and dark
pnpm --filter @playwright-intent/animations render overview --theme dark
pnpm --filter @playwright-intent/animations stills 3.4 12 20.5
```

`render` writes `docs/assets/animations/<scene>-<theme>.webp` and `.webm`. WebM needs `ffmpeg` on your `PATH`; pass `--format webp` to skip it. Other options are `--fps` (24), `--scale` (2, the device pixel ratio), and `--from` and `--to` in seconds, for rendering part of a scene.

WebP frames are lossless, which keeps code sharp and is smaller than lossy for these scenes. Runs of identical frames become one longer frame, so held moments cost nothing. What costs is change: a fade changes every pixel of what's fading on every frame, while a wipe, a cut or a small moving marker only changes a strip. The README's animation is about 3.5 MB per theme; keep an eye on that number when adding motion.

`stills` saves single frames at the times you give, which is the quickest way to check a change. The preview reloads when a file in `src` changes and keeps its place. Space plays and pauses, arrow keys step a frame, and shift-arrow steps a second.

## Scenes

| Scene      | Used in | Shows                                                                                                                          |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `overview` | README  | An intent replaces hand-written steps, the agent saves a step, then review, replay, and a repair committed to the pull request |

## Writing a scene

A scene is a file in `src/scenes` that exports `defineScene({ title, width, height, build })`. `title` is the image's alt text. `build(stage, tl)` adds elements to the stage and schedules them on the timeline:

```ts
import { card, place } from "../runtime/cards.ts";
import { h } from "../runtime/dom.ts";
import { chapters, defineScene } from "../runtime/scene.ts";

export default defineScene({
	title: "What the agent does when a step fails for real",
	width: 960,
	height: 540,
	build(stage, tl) {
		chapters(stage, tl, [{ title: "The app breaks", at: 0.5 }], 6);

		const diagnosis = place(card({ title: "Diagnosis" }), {
			x: 20,
			y: 60,
			w: 320,
		});
		stage.append(diagnosis);
		tl.enter(diagnosis, 1.0);
		tl.hold(6);
	},
});
```

The timeline is a stack of paused Web Animations, each with an absolute start time, and rendering a frame sets their `currentTime`. That gives a few rules:

- **An element's own style is its first frame.** Everything fills forwards only, so before its first tween an element looks as you built it. Helpers like `enter`, `fadeIn` and `expand` set that starting style for you.
- **Tweens on one property go in time order.** Each tween starts from whatever the tweens before it left, so add them in the order they happen.
- **Positions come from layout, at build time.** Append elements before measuring them with `offsetWithin` or `ShopBrowser.point`, and measure before anything is hidden. `expand` and `collapse` measure natural heights for you.
- **Nothing random, and no timers.** Anything that moves has to be on the timeline, or frames won't match between renders. Use `tl.loop` for things like spinners.

The timeline's main calls are `to`, `set`, `keyframes`, `enter`, `exit`, `fadeIn`, `fadeOut`, `expand`, `collapse`, `type`, `erase`, `loop` and `hold`. Each returns when it ends, so steps can follow each other: `t = tl.type(line, t + 0.2)`.

### Building blocks

- `runtime/editor.ts`: `Editor` with tabs, `CodeView` for numbered, highlighted lines with gutter icons, and `peek` for a file opened under a line. Give a line a `key` to animate it, and a piece an `id` to type or erase it.
- `runtime/cards.ts`: `card`, `swap` for states that replace each other in place, `spinner`, `ShopBrowser` with a pointer the agent drives, and `RunList` for CI runs.
- `runtime/scene.ts`: `chapters` for numbered captions with a progress bar, and `titleCard`.
- `runtime/theme.css`: the light and dark palettes, as CSS variables on `.stage`. Use the variables, like `var(--green)`, in tweens too, so both themes render from one scene.

Keep code in scenes true to the library: real API names, step file headers and commit messages, so the animation never shows something the library doesn't do.

## Embedding

Use both themes with a `<picture>`, so the animation matches the reader's GitHub theme:

```html
<picture>
	<source
		media="(prefers-color-scheme: dark)"
		srcset="docs/assets/animations/overview-dark.webp"
	/>
	<img
		src="docs/assets/animations/overview-light.webp"
		alt="…the scene's title…"
	/>
</picture>
```
