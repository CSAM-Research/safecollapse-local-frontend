# safecollapse-viewer

Local-only, read-only results viewer for the safety-collapse study. It indexes the
export under `~/Workspace/safecollapse-viewer-data/` and serves a small web UI on
`127.0.0.1` so you can browse dashboards without opening JSON files.

The data export contains model answers to harmful requests. Never commit or publish it.
The viewer never makes network requests.

![Trace detail in safecollapse — score over generations for a HarmBench prompt](docs/screenshots/trace-detail.png)

*Trace detail for `lillies_cats_feeding_persuasion` (IT / G1), with answers hidden.*

## Requirements

- Python 3.12+ (stdlib only)
- Node.js 20+ (to build the front end once)

## Quick start (Docker — recommended for demos)

On Pop!_OS with Docker installed:

```bash
./start-docker.sh
```

Opens [http://127.0.0.1:8765/](http://127.0.0.1:8765/). Stop with `./stop-docker.sh`.

The container mounts `~/Workspace/safecollapse-viewer-data` read-only and reuses
`./.cache` so startup stays fast after the first index.

Override the data path if needed:

```bash
SAFECOLLAPSE_DATA=/path/to/safecollapse-viewer-data ./start-docker.sh
```

## Quick start (local, no Docker)

```bash
npm install
python serve.py
```

Then open [http://127.0.0.1:8765/](http://127.0.0.1:8765/).

`serve.py` builds the index into `.cache/` if needed, builds the front end into `dist/`
if needed, and serves only on the loopback interface.

### Useful flags

```bash
python serve.py --reindex          # refresh .cache after a data re-export
python serve.py --rebuild-ui       # force vite rebuild
python serve.py --data /path/to/safecollapse-viewer-data
python build_index.py --data /path/to/safecollapse-viewer-data
```

## Layout

| Path | Role |
|---|---|
| `build_index.py` | Walks the data root; writes `.cache/index.sqlite`, `.cache/catalogue.json`, `.cache/dashboards/*.json` |
| `serve.py` | `127.0.0.1:8765` static + `/api/*` |
| `src/` | TypeScript front end (Vite) |
| `docs/` | Brief, context, agent prompt, plan |
| `.cache/` | Derived only; git-ignored; safe to delete |

## Current status

- **Overview** per study: headlines, generation curves, ASR×PPL scatter, confirmatory tests,
  jailbreaks, late collapse, data health.
- **Traces**: filterable prompt table → detail with score-over-generations chart, judges, and
  across-generation answers (harmful answers hideable).
- **Checkpoints**, **Compare**, **Labels**, **Judges** pages; Docker one-command start.

## License

MIT — see [LICENSE](LICENSE).

## Docs

- `docs/VIEWER_BRIEF.md` — specification
- `docs/PROJECT_CONTEXT.md` — experiment background
- `docs/PLAN.md` — implementation plan
