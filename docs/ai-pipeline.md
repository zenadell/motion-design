# The AI director (phase 2)

A model plans the video; the engine makes it. Nothing at runtime needs Claude. The default model is Google's **Gemini 3.8 Flash**.

```
website ──► scrape ──► brand kit ──► planner ──► validate ⇄ repair ──► render frames ──► visual review ⇄ revise ──► MP4
            (Chromium)   (Gemini)     (Gemini)   (code + Gemini)                          (Gemini vision)
```

## Setup

1. Get an API key at <https://aistudio.google.com/apikey>.
2. Make it available as `GEMINI_API_KEY` (or `GOOGLE_API_KEY`):
   - **locally:** `export GEMINI_API_KEY=...`
   - **Claude Code on the web:** add it as an environment variable in the environment's settings; new sessions pick it up.
   - **GitHub Actions:** add a repository secret named `GEMINI_API_KEY`, then run the **Live (Gemini)** workflow or add the `live-test` label to a pull request.
3. Check which models the key can use: `motion models`.

Never commit the key or paste it into a chat.

## Commands

```bash
# everything: brand kit → plan → visual review → MP4 (+ HTML preview, contact sheet, report)
motion make https://jomiez.com --brief "A confident showreel for our software studio" --seconds 20 -o out/jomiez

# or step by step
motion brand  https://jomiez.com -o out/brand.json            # colours, fonts, facts, vector logo
motion plan   --brand out/brand.json --brief @brief.txt --seconds 20 -o out/plan.json
motion review out/plan.json --brand out/brand.json            # vision critique of rendered frames
motion render out/plan.json -o out/video.mp4
```

| flag | meaning |
|---|---|
| `--brief "..."` or `--brief @file.txt` | what the video should say, who it's for, anything it must include |
| `--seconds 20` | target length (6–90). It is converted to beats and enforced exactly |
| `--genre afro-house\|electro`, `--bpm 120` | music; the planner picks the genre if you don't |
| `--logo mark.svg` | use this logo instead of the one found on the site (SVG or PNG) |
| `--brand brand.json` | skip extraction and use (or hand-edit) an existing brand kit |
| `--qa 2`, `--no-qa` | review → revise rounds (default 1) |
| `--model gemini-3.8-flash` | any model id from `motion models`; also `MOTION_MODEL` |
| `--effort low\|medium\|high` | planner thinking level (default medium) |
| `--no-render` | stop after the plan, contact sheet and HTML preview |
| `--replay replies.json` | play back recorded model replies instead of calling the API (tests, CI) |

`make` writes `brand.json`, `plan.json`, `review-N.json`, `sheet.png`, `reel.html`, `video.mp4` and `report.json` (every step, every issue found, tokens and cost).

## Why Gemini 3.8 Flash

As of September 2026 it is Google's newest Flash model (released 2 September 2026). It takes images, which the brand and review steps need, and it supports structured output with a JSON Schema and a thinking level. The price is $0.75 per 1M input tokens and $3.75 per 1M output tokens (introductory, until 31 December 2026; then $1.50 / $7.50).

In the first live run (Jomiez, 20 s, one review round), the model calls cost **$0.08**:

| step | input tokens | output + thinking tokens | cost |
|---|---:|---:|---:|
| plan | 10.6k | 5.4k | $0.028 |
| review (15 frames) | 18.0k | 0.2k | $0.014 |
| revise | 12.0k | 7.8k | $0.038 |

Brand extraction adds roughly a cent. `report.json` shows the real figure for every run.

- **Gemini 3.7 Flash** is the same price and uses fewer tokens, with slightly weaker planning. Use `--model gemini-3.7-flash` if cost matters more than polish.
- **Gemini 4** was announced but not released at the time of writing. When it ships, try it with `--model`; nothing else changes.

## How a plan stays good

The model writes very little. The engine owns every pixel and every sound, so the model only chooses techniques, copy and timing. Guardrails:

1. **The brand is injected, not generated.** The planner never sees or writes colours, fonts or the logo. It gets them as context, and the pipeline merges them into the plan.
2. **Structured output.** The response schema has one branch per technique, so params are typed by the technique the model picks (`src/ai/schema.ts`).
   - Array bounds (`minItems` on the sections list, and every `maxItems`) are kept out of the schema and moved into descriptions. Gemini counts each bounded position as schema states, and with 22 branches the bounds exceed its limit (a bare `400 INVALID_ARGUMENT`).
   - If the API still rejects the schema, the planner continues with free-form JSON. The validator is the real gate either way.
3. **Validate → repair.** Every draft goes through `validatePlan`. Errors come back to the model with exact paths and "did you mean" hints, up to three rounds.
4. **Lint** (`src/ai/lint.ts`) enforces what a schema can't:
   - **Length:** small differences are fixed in code by resizing flexible sections. Big ones go back to the model.
   - **Arc:** the plan must open on a hook and end on an outro.
   - **Variety:** no technique twice in a row.
   - **Facts:** every number, place and project name in the copy must appear in the brief or the brand facts. A made-up "15 countries" is sent back for repair.
5. **Visual review** (`src/ai/qa.ts`). Settled frames of every section are rendered and shown to the model with the plan. It scores the draft and lists concrete problems as plan edits (clipped words, low contrast, weak pacing, invented facts). Below 8/10, or on any high-severity issue, the planner revises in the same conversation and the result is validated again.

## Brand extraction

`src/ai/scrape.ts` opens the site in headless Chromium and collects:
- a homepage screenshot;
- colours weighted by how much of the page they cover, plus button colours and CSS custom properties;
- heading and body fonts;
- headings, navigation, buttons and body text;
- contact emails;
- every plausible logo: header SVG or IMG linking home, mask-icon, apple-touch-icon and favicons.

Gemini reads all of it, including images of each logo candidate. It returns the kit, picks the candidate that is the brand mark, and names the mark's colour when it sits on a tile. Code then enforces what the engine needs (`src/ai/brand.ts`):
- the background is dark (a light site keeps its paper colour as `light`);
- text reaches 7:1 contrast and the primary colour at least 2.6:1;
- fonts come from the embedded registry;
- the tagline fits.

The logo becomes SVG path data (`src/ai/vectorize.ts`):
- A single-path SVG is used verbatim.
- Anything else is rasterised and traced with exact pixel-edge contours, then simplified.
- App-icon tiles are split so only the symbol is kept, and combination marks drop the wordmark.
- If the site's logo isn't right, pass `--logo`.

## Testing without a key

`test/fixtures/site` is a small website, and `test/fixtures/replay-kora.json` holds recorded model replies for it. The recording deliberately includes an invented statistic and a medium-severity review note, so a replay run exercises the repair loop and the revise loop:

```bash
motion make "file://$PWD/test/fixtures/site/index.html" --brief "Launch reel" --seconds 16 --qa 2 \
  --replay test/fixtures/replay-kora.json -o out/make-kora
```

CI runs this on every push. The unit tests in `test/ai.test.ts` drive the planner with a scripted fake model.
