# Architecture

```
src/
  plan/                 the contract
    schema.ts           zod schema for a plan (brand, music, meta, sections)
    validate.ts         validation + defaults + model-friendly error paths
    fonts.ts            embeddable font registry (@fontsource packages)
    demo.ts             neutral demo brand used by the gallery and tests
  engine/               runs in the browser (bundled to dist/engine.js)
    core/               math, colour, drawing, 3D camera, theme, beat timeline
    assets/             logo (SVG path → canvas, tile, traced outline), icons, world land dots
    audio/              synth instruments, chord parser, genre music bed + sidechain
    techniques/         the library — one file per technique + registry (index.ts)
    render.ts           frame composition: sections, transitions, shake, motion blur, HUD, grain, soundtrack
    player.ts           interactive playback + window.__reel automation API
    index.ts            MotionEngine.boot({ plan, land })
  ai/                   the AI director (Node)
    llm.ts              provider interface, JSON extraction, usage + cost
    gemini.ts           Gemini via @google/genai (structured output, thinking level, retries)
    schema.ts           Gemini-subset JSON Schemas (one branch per technique)
    prompts.ts          planner / brand / critic prompts (the planner gets the authoring guide + catalog)
    planner.ts          draft → validate → lint → repair loop; revise() for review feedback
    lint.ts             length fitting, arc, variety, fact check against the brief + brand facts
    brand-kit.ts        brand + facts the planner may state
    scrape.ts           headless site reading: screenshot, colours, fonts, copy, logo candidates
    vectorize.ts        raster logo → SVG path (pixel-edge tracing, tile + wordmark handling)
    brand.ts            scrape + Gemini → brand kit, colour/contrast rules, logo choice
    qa.ts               settled frames → Gemini vision critique → revision brief
    pipeline.ts         make(): brand → plan → review → outputs + report
    replay.ts           recorded replies instead of a model (tests, CI)
  cli/                  Node: bundled to dist/cli.js
    html.ts             single-file HTML (fonts/engine/plan/land inlined)
    browser.ts          headless Chromium via Playwright
    render.ts           parallel frame rendering → ffmpeg (H.264 + AAC)
    catalog.ts          JSON Schema + Markdown catalog for planners
    gallery.ts          smoke test: contact sheet of every technique
    ai.ts               make / brand / plan / review / models / scrape commands
```

## Principles

**Everything is a pure function of time.** `technique.draw(g, lt, params, ctx)` gets the section-local time in seconds and draws a complete frame. There is no state between frames, so any frame can be rendered in any order. That is what makes parallel rendering, scrubbing, stills and motion blur trivial.

**Time is musical.** Techniques author their timings in beats (`c.bt(0.5)` is an 8th note). Change the BPM and every cut, bounce and particle morph stays on the beat.

**Theme, never hard-code.** Techniques read colour roles (`bg`, `text`, `primary`, `secondary`, `accent`, `surface`, `muted`, `light`, `dark`) and font roles (`display`, `serif`, `mono`), so one plan re-skins the whole library.

**Sound is part of the technique.** Each technique schedules its own accents (`sfx`) against the same timeline. The music bed (`audio/music.ts`) fills in the groove according to each section's `energy`. The whole soundtrack is rendered once on an `OfflineAudioContext`, so it is sample-exact against the frames.

## Rendering pipeline

1. `validatePlan` parses the JSON, applies defaults, and validates each section's params against its technique's schema.
2. `buildTimeline` lays sections end to end in seconds.
3. `createEngine` resolves the theme and brand, collects every technique's `hits` (camera shake / zoom punch) and `fast` windows (heavier motion blur), and finds hard cuts.
4. `renderFrame(t, sub)` draws the section at `t`. Inside a transition window it draws both neighbours into offscreen layers and composites them. With `sub > 1` it averages sub-frame samples for motion blur, never across a hard cut. The HUD and grain go on top.
5. The CLI loads the self-contained HTML in headless Chromium, pulls PNG frames from several pages in parallel, and streams them in order into ffmpeg together with the soundtrack WAV.

## Adding a technique

```ts
// src/engine/techniques/my-thing.ts
import { z } from 'zod';
import { define } from './types';

export default define({
  id: 'my-thing',
  title: 'My thing',
  category: 'type',
  summary: 'One or two sentences a model can use to decide when to pick this.',
  guidance: 'Copy limits, pairing and pacing advice.',
  label: 'TYPE',
  params: z.object({ word: z.string().max(12) }),
  beats: { min: 1, max: 4, default: 2 },
  energy: 2,
  example: { word: 'HELLO' },
  draw(g, lt, p, c) { /* draw a full 1920×1080 frame; c.bt(beats) → seconds */ },
  sfx(A, t0, p, c) { /* schedule accents with audio/synth */ },
  hits: (p, c) => [{ at: 0, shake: 10 }],
});
```

Then add it to `techniques/index.ts`. The catalog, docs, validation, gallery and tests pick it up automatically. `npm test` checks that the example validates, and `npm run smoke` renders it.

## Roadmap

**Phase 1 (done):** the engine, the technique library, the plan contract, the CLI renderer, and QA tooling.

**Phase 2 (done): the model as director.** Nothing in the runtime needs Claude. See [ai-pipeline.md](ai-pipeline.md).
- **Brand extractor:** takes a URL or a logo file and produces the brand kit: colours, fonts mapped to the registry, facts, and the logo vectorised to SVG path data.
- **Planner:** Gemini 3.8 Flash gets the brief, the brand facts, the catalog and [authoring-guide.md](authoring-guide.md), and returns a plan using structured output (one schema branch per technique).
- **Repair loop:** validator and lint issues go back to the model until the plan is clean. Small length errors are fixed in code.
- **Visual QA loop:** settled frames of every section go to Gemini vision. Its fixes go back to the planner in the same conversation.

**Phase 3: product.** A web app to upload a brand, pick a recipe, preview live in the browser (the engine already runs there), edit copy and timing, and export. Plus a render queue on server workers, 9:16 and 1:1 formats, and more genres and techniques.

### Studio UI (phase 3)

- **Stack:** React + Vite + TypeScript, in `apps/studio` next to the engine. The engine stays framework-free. A thin `<ReelPreview plan>` component calls `createEngine(plan)` and draws `renderFrame` onto a `<canvas>` inside `requestAnimationFrame`, and a `useReel` hook exposes play, seek, the current section and beat.
- **Design language:** clean, neat liquid glass, built on [`@samasante/liquid-glass`](https://github.com/samasante/liquid-glass) (React, zero runtime dependencies, works in Chrome, Safari and Firefox).
  - **Transport over the preview:** `<Glass draw={(ctx, t) => …} lenses={…}>` refracts the live reel canvas through each control (play, scrub, section chips). Our frames are the "wallpaper" the glass bends.
  - **Panels:** the plan editor, brand panel and technique picker are `<Glass>` materials over a slowly animating brand-tinted backdrop. Wide bars (the timeline dock) use a frost-only treatment, as the library recommends for very wide panels.
  - **Controls:** the switch and slider recipes from the library's `examples/` (energy, BPM, grain), copied in and restyled.
- **Screens:** Brief (URL or logo upload → extracted brand) → Plan (sections on a beat-snapped timeline, with a technique picker fed by `catalog --json`) → Preview (live canvas + contact sheet) → Export (render queue, progress, download).
