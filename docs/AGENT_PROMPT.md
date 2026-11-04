# Task: build a local results viewer for my safety-collapse study

I'm an MSc researcher. My experiment asks whether **model collapse** (training language models
recursively on their own outputs) erodes their **safety behaviour** (refusing harmful requests).
It has produced thousands of model answers, judge verdicts and metrics across many model
checkpoints, stored as JSON/JSONL/CSV files. I want a **local, read-only web viewer** so I can
explore all of it without opening files: an overview dashboard of the whole experiment, plus
detailed pages down to every individual prompt, answer and judge verdict. It replaces a generic
observability tool (Langfuse) with something built for this exact experiment.

It is for me alone, on my laptop. It does not need to be production-ready, deployed, multi-user
or scalable beyond my data. It can be static plus a small local index; that's fine.

## Read these first (in this repository)
1. `docs/VIEWER_BRIEF.md`: the specification. What to build, hard constraints, exact data
   layout and file schemas, design direction, verification. **This is the source of truth;
   follow it.**
2. `docs/PROJECT_CONTEXT.md`: background on the experiment, terminology, how every number is
   computed, the results so far, and incidents/caveats (e.g. one run is invalid and must be
   flagged as such).
3. `docs/paper.pdf`: the current paper draft, so you see which numbers and comparisons matter.

The data is in `~/Workspace/safecollapse-viewer-data/` (read-only, about 2.3 GB). Explore it to
confirm the brief's schemas before you design the index.

## The design reference (attached screenshot)
I've attached a screenshot of a design I like. Use it as **direction for the look and feel**:
the overall layout, information density, typography, spacing, colour restraint and the general
"quiet, precise tool" character. Do **not** copy it literally (no logos, brand names, icons or
content from it), and do not force our data into its exact components; adapt the style to what
our data needs. Where the screenshot and the brief's design section (section 5) disagree, ask me.
I care a lot about a clean, sleek result: no generic "AI-made" UI (no gradients, glassmorphism,
glow, emoji, card soup or marketing copy).

## Non-negotiables (summarised; full list in the brief, section 2)
- **No network access of any kind** at build or run time from the app: no CDNs, remote fonts,
  analytics, telemetry or external APIs. Everything bundled locally. Serve on `127.0.0.1` only.
- **The data folder is read-only.** Never write to it or change its permissions. All derived
  files (index, cache) go in `.cache/` in this repository (git-ignored).
- **Work only in this repository.** You don't need, and must not look for, any other code on the
  machine.
- **The data contains harmful content** (model answers to requests for dangerous information,
  jailbreak prompts). Never copy any of it into code, tests, fixtures, docs, screenshots or
  commits. Use small synthetic fixtures you write yourself. In the UI, answers to harmful
  requests are **collapsed by default** with click-to-reveal.
- Don't run any models or call any judge APIs: the viewer only reads results.
- Don't commit unless I ask. Never commit the data or the cache.

## How I'd like you to work
1. **Explore and plan (no UI code yet).** Read the docs, inspect the data folder, then write a
   short plan in `docs/PLAN.md`: the stack you chose and why, the index design (what you
   pre-compute, how files are loaded on demand), the page list with what each shows, and any
   data quirks you found. Keep it brief. Show me before continuing if anything in the brief
   looks wrong or ambiguous.
2. **Design first, with one page.** Build the indexer and the overview dashboard for the main
   study only, styled to the reference. Give me the command to run it and stop for my feedback
   on the look before building the remaining pages.
3. **Then build the rest** in this order: checkpoint page -> prompt/answer browser (including the
   same prompt across all generations) -> remaining dashboard panels and the other studies ->
   jailbreak, judge-validation and decisions pages -> synthetic-data browser -> nice-to-haves.
4. **Verify** as the brief's section 7 describes: tests on synthetic fixtures, a test that your
   per-checkpoint numbers match `runs/main/results/summary.csv`, a check that the built app makes
   no network requests, and a manual pass over every page type on the real data. Report any
   data inconsistencies to me; don't "fix" the data.
5. Keep me updated briefly as you go. When a choice is unclear, ask instead of guessing.

## Done means
- One documented command builds the index and starts the viewer at `http://127.0.0.1:<port>`.
- I can, without opening a file: see the experiment at a glance (generation curves per arm,
  safety vs perplexity, jailbreaks, the planned tests, data health); open any checkpoint and
  see everything about it; find any prompt, read the prompt and each checkpoint's answer, every
  judge's verdict and raw reply, and follow that prompt across generations; browse the judge
  validation and the decision log.
- It looks clean and deliberate, close in spirit to the reference screenshot.
- README explains setup, commands, and how to re-index after I refresh the data folder.
