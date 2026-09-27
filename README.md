# motion-design

Beat-synced motion design videos from a JSON plan.

You describe **what** happens: sections, copy, brand colours, music. The engine decides **how** it looks and sounds. That covers kinetic typography, particle morphs, a 3D camera, a dot globe, logo builds, transitions, film grain, motion blur, and a synthesized soundtrack whose every hit lands on the cut.

The plan is small and strictly validated, so it's easy for a person or a language model to write. The **AI director** (Gemini 3.8 Flash by default) writes it for you from a website and a brief. See [docs/ai-pipeline.md](docs/ai-pipeline.md).

```
website ──► brand kit ──► plan ──► validate ⇄ repair ──► visual review ⇄ revise ──► engine ──► MP4
          (Gemini)      (Gemini)   (code)                 (Gemini vision)          (canvas + Web Audio, deterministic)
```

```bash
export GEMINI_API_KEY=...        # https://aistudio.google.com/apikey
motion make https://jomiez.com --brief "A confident showreel for our software studio" --seconds 20 -o out/jomiez
```

## Quick start

```bash
npm install
npx playwright install chromium   # one-time: the headless browser used for rendering
npm run build

node dist/cli.js validate examples/jomiez.plan.json
node dist/cli.js stills   examples/jomiez.plan.json          # contact sheet → out/jomiez-stills/sheet.png
node dist/cli.js html     examples/jomiez.plan.json -o out/jomiez.html
node dist/cli.js render   examples/jomiez.plan.json -o out/jomiez.mp4 --workers 4
```

Open the HTML file in any modern browser and press **Play**. It is a single offline file with the fonts, engine, plan and music all inlined.

## What's in the box

- **22 techniques**, each a parameterised, beat-relative scene with its own sound design. They're listed in [docs/techniques.md](docs/techniques.md) (generated from the source):
  - **Intro:** blade open, word cuts, glitch word, impact word
  - **Type:** weight-wave word, dot-matrix word, Swiss stack, card-flip word, marquee, type drop
  - **UI:** 3D code editor, exploded UI layers
  - **Shape:** particle morph (25 icons + the brand logo), mitosis grid, Albers colour study
  - **Camera:** portal dolly
  - **Data:** dot globe, montage, stat odometer
  - **Brand:** logo build
  - **Outro:** end card, signature card
- **8 transitions:** `cut`, `blade`, `slice`, `flash`, `fade`, `slide`, `zoom`, `wipe`.
- **Soundtrack engine:** afro-house or electro grooves generated from the timeline. A section's `energy` sets how much of the kit plays, and every technique adds its own accents (key clicks under typing, a whoosh per camera move, a marimba note per particle morph). A sidechain ducks the bass and pads on every kick.
- **Brand theming:** colours and fonts come from the plan. Missing colours are derived automatically, and a brand without a logo gets a traced monogram.
- **Renderer:** headless Chromium drives the deterministic engine frame by frame across parallel workers, with motion-blur accumulation and ffmpeg encoding.
- **QA tooling:** labelled contact sheets (`stills`), a render-every-technique smoke test (`gallery`), and a machine-readable catalog with JSON Schemas (`catalog --json`).
- **AI director:**
  - brand extraction from a URL (colours, fonts, facts, and a vector logo traced from the site);
  - a planner that repairs its own plans against the validator;
  - a fact check that blocks invented numbers and names;
  - a vision review of rendered frames that sends fixes back to the planner;
  - a cost report for every run.

## CLI

```
motion validate <plan.json> [--json]          check a plan; --json prints machine-readable issues
motion html     <plan.json> [-o out.html]      self-contained interactive HTML
motion stills   <plan.json> [-o dir] [--at 1.5,3] [--sheet] [--blur 6]
motion render   <plan.json> [-o out.mp4] [--crf 18] [--workers N] [--blur 6] [--from s] [--to s]
motion audio    <plan.json> [-o out.wav]
motion catalog  [--json | --md]
motion gallery  [-o dir] [--quick] [--only id,id]

# AI director (GEMINI_API_KEY)
motion make     <url> --brief "..." [--seconds 20] [--genre g] [--logo mark.svg] [--qa 1] [-o dir]
motion invent   <url> | --brand brand.json --brief "..." [--seconds 24] [-o dir]   (the model designs + codes every scene)
motion brand    <url> [-o brand.json]
motion plan     --brand brand.json --brief "..." [--seconds 20] [-o plan.json]
motion review   <plan.json> [--brand brand.json]
motion models
motion scrape   <url> [-o dir]
```

`MOTION_CHROMIUM_PATH` and `MOTION_FFMPEG_PATH` override the browser and ffmpeg binaries.

## A plan, briefly

```json
{
  "meta": { "title": "Launch" },
  "brand": {
    "name": "Northwind", "suffix": "Studio", "tagline": "Design and engineering for ambitious teams.",
    "site": "northwind.studio", "email": "hello@northwind.studio",
    "colors": { "bg": "#0A0C14", "text": "#EEF1F8", "primary": "#3D5AFE" },
    "fonts": { "display": "Space Grotesk" }
  },
  "music": { "bpm": 120, "genre": "afro-house" },
  "sections": [
    { "technique": "blade-open", "beats": 0.5 },
    { "technique": "word-cuts", "beats": 1.5, "params": { "words": ["WE", "SHIP", "FAST"] } },
    { "technique": "glitch-word", "beats": 2, "params": { "word": "PRODUCTS" }, "transition": "blade" },
    { "technique": "logo-build", "beats": 4 },
    { "technique": "end-card", "beats": 8 }
  ]
}
```

The full format is in [docs/plan-format.md](docs/plan-format.md), and the creative rules for writing good plans are in [docs/authoring-guide.md](docs/authoring-guide.md). The planner model gets that same guide as its instructions. The two examples in [`examples/`](examples) reproduce the Jomiez Innovation showreel (26 s) and the résumé reel (15 s).

## Development

```bash
npm run check        # typecheck + unit tests + build
npm run smoke        # render every technique's example (needs Chromium)
npm run gen:docs     # regenerate docs/techniques.md from the source
```

Adding a technique is one file in `src/engine/techniques/` plus a line in its `index.ts`. See [docs/architecture.md](docs/architecture.md#adding-a-technique).
