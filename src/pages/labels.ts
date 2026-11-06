import {
  ARM_ROWS,
  EXAMPLE_CHECKPOINTS,
  LABEL_TABLE,
  STUDY_ROWS,
} from "../lib/glossary";
import { renderAnswerStory } from "../lib/story";
import type { Catalogue } from "../lib/types";

function rowsHtml(
  rows: { label?: string; arm?: string; id?: string; paper: string; means: string; path?: string }[],
  key: "label" | "arm" | "id",
): string {
  return rows
    .map((r) => {
      const name = (r as Record<string, string | undefined>)[key] || "";
      return `<tr>
        <td class="lab-code"><code>${name}</code></td>
        <td>${r.paper}</td>
        <td>${r.means}${r.path ? `<div class="page-meta mono-path">${r.path}</div>` : ""}</td>
      </tr>`;
    })
    .join("");
}

export function renderLabelsPage(mount: HTMLElement, _catalogue: Catalogue): void {
  mount.innerHTML = `
    <nav class="crumb">
      <span class="here">Labels</span>
      <span class="sep">·</span>
      <span>paper ↔ meaning</span>
    </nav>

    <header class="page-header">
      <div>
        <h1 class="page-title">Checkpoint labels</h1>
        <p class="page-meta">
          How the paper writes a checkpoint, and what that folder actually is on disk.
        </p>
      </div>
    </header>

    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">How to read a label</h2>
          <p class="section-desc">One letter for the lineage, one number for the generation.</p>
        </div>
      </div>
      <div class="label-decode">
        <div class="decode-card">
          <div class="decode-example"><code>R</code><span>5</span></div>
          <p><strong>R</strong> = replace arm (collapse). <strong>5</strong> = generation 5.</p>
        </div>
        <div class="decode-card">
          <div class="decode-example"><code>S</code><span>5</span></div>
          <p><strong>S</strong> = subsample arm (keeps original data). Same generation as R5.</p>
        </div>
        <div class="decode-card">
          <div class="decode-example"><code>A</code><span>5</span></div>
          <p><strong>A</strong> = accumulate arm (base category only). Same generation as R5.</p>
        </div>
        <div class="decode-card">
          <div class="decode-example"><code>G</code><span>1</span></div>
          <p><strong>G</strong> = shared stem before the arms split. G0 untouched, G1 first fine-tune.</p>
        </div>
      </div>
      <p class="section-desc" style="margin-top:0.85rem">
        Seeds are separate: <code>R5 · seed 0</code> is one trained model; seeds 1 and 2 are replicates.
        G0 has no seed. In health tables you may see <code>R5·s0</code> as shorthand.
      </p>
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">Core labels</h2>
          <p class="section-desc">Paper wording vs what it means in this viewer / on disk.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data glossary-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>In the paper</th>
              <th>What it actually is</th>
            </tr>
          </thead>
          <tbody>${rowsHtml(LABEL_TABLE, "label")}</tbody>
        </table>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">Endpoints the paper highlights</h2>
          <p class="section-desc">These show up in confirmatory tests, headlines, and Table VI.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data glossary-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>In the paper</th>
              <th>What it actually is</th>
            </tr>
          </thead>
          <tbody>${rowsHtml(EXAMPLE_CHECKPOINTS, "label")}</tbody>
        </table>
      </div>
    </section>

    <section class="section">
      <div class="panel-grid">
        <div class="panel">
          <h3>Arms</h3>
          <div class="table-wrap">
            <table class="data glossary-table">
              <thead><tr><th>Arm</th><th>In the paper</th><th>What it means</th></tr></thead>
              <tbody>${rowsHtml(ARM_ROWS, "arm")}</tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <h3>Studies in the sidebar</h3>
          <div class="table-wrap">
            <table class="data glossary-table">
              <thead><tr><th>Study</th><th>In the paper</th><th>What it is here</th></tr></thead>
              <tbody>${rowsHtml(STUDY_ROWS, "id")}</tbody>
            </table>
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">How answers change</h2>
          <p class="section-desc">
            Same harmful request across generations: refusal → hedge → compliance.
            The jump is usually already there by G1.
          </p>
        </div>
      </div>
      ${renderAnswerStory()}
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">Lineage</h2>
          <p class="section-desc">Both arms start from the same G1; only the training data diverges after that.</p>
        </div>
      </div>
      <pre class="lineage">G0  (untouched release)
 │
 ▼
G1  (fine-tune on original HelpSteer2)     ← most of the ASR change
 │
 ├── replace ──► R2 → R3 → R4 → R5 → … → R10   (synthetic only)
 │
 └── subsample ─► S2 → S3 → S4 → S5 → … → S10  (still has original data)
      or, in base:
      └── accumulate ► A2 → A3 → A4 → A5 → … → A10</pre>
    </section>
  `;
}
