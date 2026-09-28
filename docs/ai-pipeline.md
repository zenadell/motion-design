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

## Invent mode: the model designs and codes the whole film

`motion make` chooses from the technique library, so every film shares its look. `motion invent` lets the model build something new: it designs a visual language and writes the drawing and sound code for every scene itself. Because code written blind is weak, the pipeline makes the model **watch** what it wrote and keep only what the critic scores higher.

```bash
motion invent --brand out/brand.json --brief "Invent an entirely new visual language. Surprise us." --seconds 24 \
  --candidates 2 --rounds 2 --film-rounds 1 --budget 5 -o out/film
```

1. **Concept tournament.** The director pitches 3 radically different concepts (idea, hook, signature moment, how to build it). A judging pass ranks them on wow, buildability, fit and energy, and the winner is developed into the full direction: shot list, type, palette, motion principles and score. The director works to the standard in the [craft handbook](motion-craft.md).
2. **Code.** A shared `lib` and `score` are written, then tested on a probe scene and fixed. The coder gets:
   - the **set-piece library** (`S.set.*`, below), which the director names per scene;
   - the [Stage API](../src/engine/custom/stage.ts) and the pro toolkit: `S.type` kinetic type, `S.kf` keyframes, `S.spring`, the `S.cam` 3D camera and cards, `S.glow`/`S.bloom`, `S.drawOn`, particle morphs from icons and the logo, and `S.fx` (the engine's finished techniques as components);
   - the handbook;
   - an [exemplar](../src/ai/exemplars/kinetic-hook.js) of the code quality expected.
3. **Every scene:**
   - **N candidates** (a different creative approach each), tested and auto-fixed: exceptions, slow or blank frames, invented numbers.
   - Each candidate is rendered to a 640-px clip. The critic **watches the video** at 12 fps together with **objective measurements** (frame coverage, and still stretches with timestamps). It scores 8 dimensions (idea, composition, typography, motion, rhythm, light and colour, polish, wow) and lists the top fixes. The score is 0.7 × mean + 0.3 × the worst dimension.
   - The best candidate goes through **watch → critique → rewrite** rounds. A rewrite is kept only if its score is higher. This stops at the target score or the budget.
4. **The whole film** is tested, rendered with sound, and watched by a film critic. It scores every scene in context, and the weakest scenes get another rewrite pass.
5. The final render has motion blur, the synthesised score and the scene sound effects. Everything is saved:
   - `direction.json`, `plan.json` (all the code), `scores.json` (every candidate and round) and `review-N.mp4`/`.json`;
   - `transcript.json` (every raw reply) and `report.json` (tokens and cost).

Roles can use different models: `--code-model gemini-3.1-pro-preview --critic-model gemini-3.8-flash`. `--budget` caps optional refinement spend.

Scene code is sandboxed: no DOM, network, timers or clocks, and a seeded `Math.random`. Page requests are blocked while rendering.

### Set pieces: crafted 3D moments the model directs

The measurements below showed where Gemini falls short: scenes with real production value (depth, particles, light). Writing those from scratch each time is where a fast model is weakest, and its self-critique cannot pull it up. So the engine ships them, hand-built and deeply parameterised, and the model directs them the way a director directs a VFX team: what, where, which words and colours, which camera moves, on which beats. [setpieces.ts](../src/engine/custom/setpieces.ts):

| set piece | what it is |
|---|---|
| `S.set.swarm` | thousands of glowing 3D particles flying between shapes on the beat (sphere, torus, helix, vortex, wave, the logo, any word, icons), with depth, motion trails, bloom and bursts |
| `S.set.extrude` | solid extruded 3D type or logo with lit sides, a keyframed camera swing and a specular light sweep |
| `S.set.shatter` | a word or the logo assembling from glass shards flying in from 3D space (with a landing flash), or exploding |
| `S.set.globe` | a dotted world globe with atmosphere, graticule, flying arcs, landing ripples, pins and labels |
| `S.set.flight` | the camera flies over an endless floor through giant portal frames carrying words, with speed streaks, rolls and a flash at each pass |
| `S.set.cylinder` | rows of huge type wrapped around a rotating 3D cylinder, counter-rotating and whipping in, the back seen through |
| `S.set.rays`, `S.set.flare` | volumetric light streaming out of a word or the logo, surges on hits, and an anamorphic lens flare |
| `S.set.planes` | cards or screens floating in 3D, drawn by the scene's own code, with camera cuts between poses |

The director names one per scene (`setpiece` in the direction) and builds the film around 3–5 different ones; the coder stages each in the film's own look (backgrounds, type and overlays around it, `bg: null` to composite). Every option can be animated per frame. `test/fixtures/setpieces.plan.json` is a showcase of all of them.

### Real 3D (Three.js)

`S.set.logo3d`, `S.set.type3d` and `S.set.shapes3d` are real 3D set pieces, and `S.three` lets a scene build its own 3D world. The brand mark and any text are extruded into bevelled solids and lit in a virtual photo studio (soft boxes, reflections). Materials: chrome, gold, glass, gloss, matte, metal, neon (with bloom) and clay. Three.js lives in a separate bundle (`dist/three.js`, about 800 KB) that is inlined only into reels whose code uses it. Headless Chromium renders it with SwiftShader (software WebGL 2, no GPU), which is slower (0.2–0.8 s a frame, and parallel workers share the same CPU cores): frames that draw 3D are rendered without motion blur (one sample instead of six), and the automated speed check allows them 250 ms.

### Setting the bar, client feedback and refining

- `--bar-video a.mp4,b.mp4 --bar-code a.html,b.html` sets the quality bar. The director and the critics **watch** the reference films. The coder **studies their source code** as 9/10 craft to learn from, not to copy. Both sit at the start of the prompts so Gemini's implicit cache can reuse them.
- `--feedback "…"` or `--feedback @notes.txt` holds the client's notes on earlier versions (what they rejected, what they love). They reach the director, the concept judge, the coder and the critics.
- `motion refine <dir> --scenes id,id [--rounds 3] [--feedback …]` reworks only some scenes of a finished film (watch → critique → rewrite) and re-renders it. The rest of the film is kept exactly.

## Other models through OpenRouter

Any model id with a provider prefix runs through [OpenRouter](https://openrouter.ai) (one key, hundreds of models, provider prices passed through, exact cost reported per call). Set `OPENROUTER_API_KEY`; bare ids such as `gemini-3.8-flash` still go to Gemini directly. Every model flag takes either kind, so roles can mix providers:

```bash
motion models --openrouter --filter qwen          # the catalogue with prices and input types (no key needed)
motion invent --brand out/brand.json --brief "…" --model qwen/qwen3.8-max-0902 --critic-model gemini-3.8-flash
motion refine out/film --scenes hook --fresh --code-model z-ai/glm-5.3-flash
```

The scene critic watches video, so give it a model that takes video input (Gemini, Qwen3.8, GLM-5.3-Flash, MiniMax M3, Kimi K3); GPT and DeepSeek models take images only.

### Bake-off: which model writes the best motion?

```bash
motion bakeoff out/film --scenes hook,logo-reveal,ending \
  --models qwen/qwen3.8-max-0902,z-ai/glm-5.3-flash,openai/gpt-6-luna [--rounds 0] -o out/bakeoff
```

Every model writes the same scenes of a finished film from scratch, with identical prompts, the film's shared lib and score, and the same test → fix loop. For each scene you get one side-by-side video (the current version first, each cell labelled with the model and what it cost), a contact sheet, and `summary.json` with the critic's scores, code and critic spend, and time per model. `--rounds 1` also lets each model do one watch → rewrite round.

Behind an HTTPS proxy (some cloud sandboxes), Node's `fetch` ignores `HTTPS_PROXY`; run with `NODE_USE_ENV_PROXY=1` (Node 22.21+).

## Replicate mode: rebuild a film you love

```bash
motion replicate reference.mp4 --brand out/brand.json --brief "Our launch film" [--keep-colors] -o out/replica
```

1. The model watches the reference (with sound) and writes a shot-by-shot breakdown: timing, composition, motion and easing, type, colour, texture, camera, transitions and music.
2. It adapts the breakdown to the brand. It keeps the structure, pacing, shot types and motion language, and swaps in the brand's copy (facts only), palette and logo.
3. The invent pipeline rebuilds it. The coder sees the reference segment for every scene it writes or rewrites, and every scene critique watches the **reference segment and the render side by side**.
4. The output folder also holds `video-compare.mp4`: the reference and the copy side by side.

`--exact` copies the reference instead of adapting it: its own words, colours (the breakdown's palette becomes the theme), closest display font, shot timing (one scene per shot, cut to the reference's own shot times) and no added end card. The final video carries the reference's own soundtrack (`video-synth.mp4` keeps the synthesised one), and `--brand` is optional.

```bash
motion replicate clip.mp4 --exact --model deepseek/deepseek-v4.1-flash --critic-model google/gemini-3.8-flash -o out/copy
```

Models that cannot watch video (GPT, DeepSeek) are shown 8 evenly spaced still frames of every clip instead; the breakdown itself is written by the critic model, so give it one that watches video.

## Results so far (Jomiez, 24 s, Gemini 3.8 Flash for every role)

| run | pipeline | cost | result |
|---|---|---|---|
| v1 | direct → code → one still-frame review | $0.70 | "The Harmonic Blueprint": thin lines on black, mostly empty; its own review 6/10 |
| v2 | + toolkit, handbook, exemplar, video critique, 2 candidates, 2 rewrite rounds, film review | $1.85 | "Architecture of Intelligence": bold type on 3D slabs, motion-blur streaks, animated dashboards; film review 8/10, scene scores 4.6–6.4 |
| v3 | + concept tournament, coverage and motion measurements | stopped (credits) | "Molten Silicon": scenes scored 3–5 before the account ran out |
| v4 | + crafted presets, the two hand-made reels as the bar (videos and code), client feedback | $5.35 + $0.57 refine | "Kinetic Riso Press": huge editorial type, paper, flame-orange and ink alternating, split grids, a type iris, breakbeat score. Film review 9/10; scene scores 4.4–6.5. The ending (2.9) was refined to 4.7 with `motion refine` |
| v5 | + the set-piece library; 1 candidate, 1 rewrite round, bar videos only (no bar code) | $1.83 | "Kinetic Foundry": cream / flame-orange / ink riso world built on four set pieces (3D extruded SOFTWARE over a floor with the camera crashing through the letters, a tilted type cylinder, a shatter into WHAT WE DO BEST, a portal flight). Film review 8/10; scene scores 4.4–5.6. Weakest part again the ending (a small logo in a dark box). `motion refine` ($0.30) produced a much better ending on `S.set.extrude` (400-px 3D logo, 220-px name), but Gemini rejected it: its head-to-head judge picked whichever version it saw first in both orders, and its critic misread the 400-px logo as 200 px. A human pick put it in the final cut |

The cost column is an upper bound: it prices every input token at the full rate, but repeated prompt prefixes (the bar films and code) are billed at Gemini's cached-token rate.

## What the research says, and what we measured

- **Measured checks beat vague critique.** MoVer (SIGGRAPH 2025) raised correct AI-generated motion graphics from 58.8% to 93.6% by checking precise, time-stamped properties and feeding the failures back. We check:
  - frame coverage;
  - still stretches (at most 0.5 s, the reference reels' limit);
  - **beat precision:** every hard change, measured at 60 fps, must land on the 16th-note grid; the reference reels reach 77–95%.
- **Vision models see appearance better than timing.** Animation2Code (2026) found they reproduce how an animation looks but consistently miss its temporal dynamics. So timing is measured, not judged.
- **Pairwise judging is more reliable than absolute scores.** Candidates and rewrites are accepted on a head-to-head win, judged in both orders to cancel position bias (10–15 points in frontier judges).
- **A judge that shares the generator's blind spots adds little evidence.** This is why reference films, measurements and the client's own feedback matter more than self-review.

`scripts/film-profile.py film.mp4 …` prints an objective craft profile of rendered films side by side: cuts per beat, cut beat-sync, accents per beat, motion energy, longest still, frame fill, light/dark alternation.

| metric | Jomiez reel (hand-made) | résumé reel (hand-made) | invent v5 (Gemini + set pieces) | invent v4 (Gemini) | invent v2 (Gemini) | invent v1 (Gemini) |
|---|---:|---:|---:|---:|---:|---:|
| cuts per beat | 0.37 | 0.57 | 0.58 | 0.73 | 0.19 | 0 |
| cuts on the 16th grid | 95% | 77% | 71% | 63% | 78% | – |
| accents per beat | 1.21 | 1.47 | 0.92 | 1.10 | 0.52 | 0.15 |
| motion (mean, ‰) | 12.7 | 41.3 | 34.8 | 25.8 | 6.4 | 0.9 |
| longest still | 0.48 s | 0.37 s | 0.68 s | 0.77 s | 2.32 s | 3.33 s |
| frame fill (mean) | 0.12 | 0.23 | 0.61 | 0.31 | 0.12 | 0.05 |
| light/dark flips per beat | 0.19 | 0.53 | 0.48 | 0.23 | – | – |

By v4 the generated film matches the hand-made reels on energy, fill and cutting. It trails on beat precision and stillness, and above all on **set pieces**: scenes with depth, particles and light that carry production value. Flat type on colour, however busy, reads as "template".

**Set pieces (v5):** with the library, Gemini built four genuine set-piece scenes in its first film using them, its cut beat-sync rose from 63% to 71%, its longest still fell from 0.77 s to 0.68 s, and its light/dark alternation reached the résumé reel's level. Self-judging stayed the weak link: the best ending it wrote was rejected by its own judge (position bias) and had to be picked by a person. Letting the client pick between variants is the most reliable judge.

**Pro as coder (one scene, head to head):** Gemini 3.1 Pro rewrote v4's weakest scene twice. Rewrite 1 scored 5.7 on the rubric but lost head to head. Rewrite 2 scored 3.7 but won it. The two judges disagreed completely, and a human review ranked rewrite 1 first. All three versions kept the same modest idea and a 2-second freeze.
