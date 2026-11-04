# Plan: safecollapse-viewer

## Stack

| Layer | Choice | Why |
|---|---|---|
| Indexer | Python 3.12, **stdlib only** (`sqlite3`, `json`, `csv`, `gzip`, `pathlib`) | Brief suggests pandas; it is not installed here and is unnecessary for this shape of data. One fewer dependency. |
| Cache | `.cache/index.sqlite` + small JSON shards for dashboard payloads | SQLite for drill-down queries; JSON shards so the overview loads in one request without SQL from the browser. |
| Front end | Vite + TypeScript, **no framework** | Dense research UI, local-only; keeps the bundle small and auditable for the no-network check. |
| Charts | Vendored **uPlot** | Tiny, no CDN, good for generation curves and the ASR×PPL scatter. |
| Server | `serve.py` on `127.0.0.1` only (~80 lines) | Serves `dist/` + `/api/*` that reads `.cache/` and, on demand, individual JSONL lines from the data root (answers, judge raw). Never binds `0.0.0.0`. |
| One command | `python serve.py` (builds index if missing/stale, builds front end if needed, serves) | Also: `python build_index.py --data <root>` and `npm run build` documented separately. |

Data root: CLI `--data`, default `~/Workspace/safecollapse-viewer-data/`.

## Index design

**Discover** every node under `runs/<study>/` via `manifest.json` (84 nodes today: main 28, base 28, replication2 10, replication 10, smoke 4, pilot 4). Derive `study`, `model`, `seed`, `arm`, `generation`, `label` (G0 / G1 / R_t / S_t / A_t) from the path.

**Pre-compute into SQLite (and JSON for the dashboard):**

1. `nodes` — identity, absolute path (as relative-to-data-root), stage list from `.done/`, metric JSON blobs flattened, train-source counts (histogram only; not the text), completeness flags.
2. `prompts` — from `data/{harmbench_test,xstest_safe,sorry_bench}.jsonl` (id, benchmark, prompt text, meta). HelpSteer training prompts indexed lightly later for the synthetic browser.
3. `scores` — prefer ingesting `runs/<study>/results/scores_long.csv.gz` when present (main + base); else build from per-node verdict JSONL. Columns match the paper file. This is the prompt×checkpoint×judge table for the browser.
4. `summary_rows` — copy of `results/summary.csv` / `node_metrics.csv` / confirmatory / tracking JSON for the selected study (source of truth for aggregates).
5. `health` — per node: judge errors, judge refusals, unparsed, empty answers, `finish_reason=length` counts (from metrics + a cheap pass over completions metadata only: `n_tokens` / `finish_reason`, not answer text in the index).
6. File fingerprint table (`path → mtime, size`) so re-index is incremental.

**On demand (not in the browser bundle):** answer text and judge `raw` via API that opens the node’s `eval/<job>/…jsonl` and returns the matching `id` (and `#sample`). Synthetic / train browsers paginate the same way. Harmful answers still collapsed in the UI.

**Dashboard JSON shard** (main study first): per-seed and mean±band series for every selectable metric; headline G0/G1/R5/S5 numbers; jailbreak matrix; confirmatory table; health strip. Prefer `summary.csv` + `node_metrics.csv` + per-node metrics so charts match the paper; a test will assert ASR/refusal vs `summary.csv` to 3 decimals.

## Pages (build order)

1. **Overview (main only first)** — study chrome (IT selected); headline numbers; generation curves with metric selector; safety-vs-collapse scatter; stub slots for jailbreak / confirmatory / health (filled in step 4 of the agent prompt).
2. **Checkpoint** — one node: identity, lineage, metrics table, manifest training stats, `.done` stages, links into the prompt browser.
3. **Prompt / answer browser** — filterable table; prompt detail with judges + score formula; across-generations grid; optional two-checkpoint diff.
4. Rest of overview panels + Base / Qwen (`replication2`) / cross-study; secondary menu for smoke, pilot, **invalid `replication`** (bannered).
5. Jailbreak panel, judge-validation page, decisions / pilot markdown pages.
6. Synthetic-data browser (paginated).
7. Nice-to-haves: j/k, deep links, CSV export.

## Look and feel (proposed; see open question)

Follow brief §5 over the screenshot’s literal chrome:

- Light theme default, optional dark.
- One neutral palette, one accent, arm colours colour-blind safe (replace / subsample / accumulate / shared).
- Information-dense, typographic hierarchy, tabular figures, proportions as `0.21`.
- No gradients, glass, glow, emoji, card soup, marketing copy.
- Take from the references only: quiet spacing, clear chart focus, restrained accent for the one “headline” metric — not neon dashboard chrome.

## Data quirks found

| Finding | Implication |
|---|---|
| Export time `2026-11-04T06:45Z`; **no Gen 6–10 folders yet** | Curves stop at 5; indexer must accept new gens when re-exported. |
| `summary.csv` is **by label** (seeds averaged), 66 rows; per-seed lives in `node_metrics.csv` / `scores_long` / per-node metrics | Curves: mean over seeds from per-seed metrics; headline cards can use summary. |
| `runs/replication2` and `replication` have **no `results/`** | Compute dashboard aggregates from per-node metrics; mark analysis as “from nodes”. |
| Invalid first Qwen (`replication`) present with full tree | Secondary menu only, hard “INVALID” banner (NaN / locklock incident). |
| Gen 5 nodes have `train.jsonl` but **no `synthetic.jsonl`**; G0 has neither | Expected for leaves / untouched; don’t treat as health errors. |
| Jailbreaks + `@robust` only at G0, G1, Gen 5 (and later Gen 10) | Jailbreak panel and filters must tolerate missing jobs. |
| Base already has full `results/` (brief said it “may lag”) | Use it; still be robust if a future export drops it. |
| `scores_long` includes a `prompt` column (text) | Indexer stores prompt id only in SQLite; do not duplicate harmful prompt text into fixtures/tests. |
| Some StrongREJECT metric JSONs omit `n_judge_refused` (plain job) while jailbreak jobs include it | Treat missing as 0. |
| Harmful content throughout eval/synthetic | Synthetic fixtures only in tests; UI collapse-by-default for HarmBench / SORRY / JB. |

## Verification (later)

- Indexer tests on hand-written synthetic fixtures.
- ASR / refusal_rate per label vs `runs/main/results/summary.csv` to 3 decimals.
- Grep built assets for non-local `http(s)://`.
- Manual pass every page type on real data; report inconsistencies, don’t fix data.

## Decisions (confirmed)

1. **Theme:** light quiet default; optional flat dark (no neon/glow/glass).
2. **Port:** `8765`.
3. Quirks table accepted; proceed.

## Phase 1 status

Indexer + main overview are up. Stopped for look-and-feel feedback before checkpoint / prompt pages.
