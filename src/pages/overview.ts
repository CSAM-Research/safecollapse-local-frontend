import type uPlot from "uplot";
import {
  destroyChart,
  mountGenerationChart,
  mountScatterChart,
  resizeChart,
} from "../lib/charts";
import { armColor, armLabel, fmtInt, fmtPpl, fmtRate } from "../lib/format";
import { explainLabel, GLOSSARY_BLURB } from "../lib/glossary";
import { renderAnswerStory, renderReplacePaperTable } from "../lib/story";
import type {
  Catalogue,
  ConfirmatoryTest,
  Dashboard,
  Delta,
  LateCollapse,
  Tracking,
} from "../lib/types";

type OverviewState = {
  metric: string;
  charts: { gen: uPlot | null; scatter: uPlot | null };
};

const state: OverviewState = {
  metric: "asr_primary",
  charts: { gen: null, scatter: null },
};

function headlineOrder(dash: Dashboard): string[] {
  const preferred = ["G0", "G1", "R5", "S5", "A5", "R10", "S10", "A10"];
  return preferred.filter((k) => dash.headlines[k]);
}

function signed(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}` : s;
}

function renderHeadlines(dash: Dashboard): string {
  const keys = headlineOrder(dash);
  if (keys.length === 0) {
    return `<p class="empty">No headline numbers yet (results/ may be missing).</p>`;
  }
  return `<div class="headline-grid">${keys
    .map((label, i) => {
      const h = dash.headlines[label];
      const emphasis = i === 0 ? " emphasis" : "";
      const late = /^(R|S|A)1[0]$/.test(label) || (h.source === "nodes" && Number(label.slice(1)) > 5);
      return `<article class="headline${emphasis}${late ? " late" : ""}" title="${explainLabel(label).replaceAll('"', "&quot;")}">
        <div class="headline-label">${label}<span class="hint">${
          label === "G0"
            ? "untouched"
            : label === "G1"
              ? "first fine-tune"
              : label.startsWith("R")
                ? "replace"
                : label.startsWith("S")
                  ? "subsample"
                  : label.startsWith("A")
                    ? "accumulate"
                    : ""
        }${h.source === "nodes" ? " · from nodes" : ""}</span></div>
        <div class="headline-metrics">
          <div class="kv"><span>ASR</span><strong>${fmtRate(h.asr)}</strong></div>
          <div class="kv"><span>PPL</span><strong>${fmtPpl(h.perplexity ?? null)}</strong></div>
          <div class="kv"><span>IFEval</span><strong>${fmtRate(h.ifeval ?? null)}</strong></div>
          <div class="kv"><span>over-ref.</span><strong>${fmtRate(h.over_refusal ?? null)}</strong></div>
        </div>
      </article>`;
    })
    .join("")}</div>`;
}

function deltaTakeaway(d: Delta): string {
  if (d.id === "G0_G1") {
    return d.delta_asr !== null && d.delta_asr > 0.05
      ? "Most of the ASR jump is here — ordinary fine-tuning, before collapse recursion."
      : "Little ASR change at the first fine-tune.";
  }
  if (d.id === "G1_R5") {
    const asrFlat = d.delta_asr !== null && Math.abs(d.delta_asr) < 0.04;
    const pplUp = d.delta_ppl !== null && d.delta_ppl > 0.1;
    if (asrFlat && pplUp) {
      return "ASR flat, perplexity up — collapse without further safety loss.";
    }
    if (asrFlat) return "ASR stays nearly flat across replace recursion to Gen 5.";
    return d.note;
  }
  if (d.id === "R5_R10") {
    const asrFlat = d.delta_asr !== null && Math.abs(d.delta_asr) < 0.05;
    const pplUp = d.delta_ppl !== null && d.delta_ppl > 0.1;
    if (asrFlat && pplUp) {
      return "Late collapse: perplexity still rises; compliance does not.";
    }
    return "Exploratory late-collapse extension.";
  }
  if (d.id === "R5_S5" || d.id === "R5_A5") {
    return "Matched / workflow contrast for H3 — keeping original data does not clearly lower ASR here.";
  }
  return d.note;
}

function renderDeltas(deltas: Delta[] | undefined): string {
  if (!deltas?.length) return "";
  const show = deltas.filter((d) =>
    ["G0_G1", "G1_R5", "R5_R10", "R5_S5", "R5_A5"].includes(d.id),
  );
  if (!show.length) return "";
  return `<div class="finding-strip">
    ${show
      .map((d) => {
        const asrFlat = d.delta_asr !== null && Math.abs(d.delta_asr) < 0.03;
        const pplUp = d.delta_ppl !== null && d.delta_ppl > 0.05;
        return `<article class="finding">
          <div class="finding-title">${d.title}</div>
          <div class="finding-metrics">
            <div class="kv"><span>Δ ASR</span><strong class="${asrFlat ? "flat" : ""}">${signed(d.delta_asr)}</strong></div>
            <div class="kv"><span>Δ PPL</span><strong class="${pplUp ? "rise" : ""}">${signed(d.delta_ppl, 2)}</strong></div>
          </div>
          <p class="finding-takeaway">${deltaTakeaway(d)}</p>
        </article>`;
      })
      .join("")}
  </div>`;
}

function renderTracking(tracking: Tracking | null | undefined): string {
  if (!tracking || !tracking.levels) {
    return `<p class="empty">Tracking (Spearman ASR ↔ PPL) not available.</p>`;
  }
  const rho = tracking.levels.rho;
  const ci =
    tracking.levels.ci_low !== undefined && tracking.levels.ci_high !== undefined
      ? ` [${fmtRate(tracking.levels.ci_low, 2)}, ${fmtRate(tracking.levels.ci_high, 2)}]`
      : "";
  const weak = rho !== undefined && Math.abs(rho) < 0.4;
  return `<div class="tracking-card">
    <div class="tracking-rho">
      <span class="stat-label">Spearman ρ (levels)</span>
      <div class="stat-value ${weak ? "flat" : ""}">${fmtRate(rho ?? null, 3)}</div>
      <div class="page-meta">95% CI${ci} · ${tracking.n_checkpoints ?? "—"} checkpoints · ${tracking.n_seeds ?? "—"} seeds</div>
    </div>
    <p class="section-desc">
      Collapse metrics are not a safety warning: held-out perplexity moves while ASR stays nearly flat.
      ${
        tracking.levels_replace !== undefined
          ? `Replace ρ ${fmtRate(tracking.levels_replace, 3)}.`
          : ""
      }
      ${
        tracking.levels_subsample !== undefined
          ? ` Subsample ρ ${fmtRate(tracking.levels_subsample, 3)}.`
          : ""
      }
      ${
        tracking.levels_accumulate !== undefined
          ? ` Accumulate ρ ${fmtRate(tracking.levels_accumulate, 3)}.`
          : ""
      }
    </p>
  </div>`;
}

function renderLateCollapse(late: LateCollapse | undefined, arms: string[]): string {
  if (!late?.available) {
    return `<p class="empty">${late?.note || "No late-collapse checkpoints."}</p>`;
  }
  const gens = late.generations || [1, 5, 6, 7, 8, 9, 10];
  const head = `<tr><th>gen</th>${arms
    .map(
      (a) =>
        `<th class="num" colspan="2" style="color:${armColor(a)}">${armLabel(a)}</th>`,
    )
    .join("")}</tr>
    <tr><th></th>${arms.map(() => `<th class="num">ASR</th><th class="num">PPL</th>`).join("")}</tr>`;
  const rows = gens
    .map((g) => {
      const cells = arms
        .map((arm) => {
          const row = (late.arms[arm] || []).find((r) => r.generation === g);
          return `<td class="num">${fmtRate(row?.asr ?? null)}</td><td class="num">${fmtPpl(row?.perplexity ?? null)}</td>`;
        })
        .join("");
      return `<tr><td>${g}</td>${cells}</tr>`;
    })
    .join("");
  return `<p class="section-desc" style="margin-bottom:0.65rem">${late.note}</p>
    <div class="table-wrap"><table class="data compact">
      <thead>${head}</thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function renderJailbreaks(dash: Dashboard): string {
  const labels = Object.keys(dash.jailbreaks);
  if (labels.length === 0) {
    return `<p class="empty">Jailbreak scores not available for this study.</p>`;
  }
  const templates = ["plain", "aim", "prefix_injection", "refusal_suppression"];
  const heads = templates
    .map((t) => `<div class="head">${t.replaceAll("_", " ")}</div>`)
    .join("");
  const rows = labels
    .map((label) => {
      const row = dash.jailbreaks[label];
      return `<div class="lab">${label}</div>${templates
        .map((t) => `<div class="num">${fmtRate(row[t] ?? null)}</div>`)
        .join("")}`;
    })
    .join("");
  return `<div class="jb-grid"><div class="head">label</div>${heads}${rows}</div>`;
}

function fmtTest(t: ConfirmatoryTest | undefined, slope = false): string {
  if (!t) return "—";
  const est = slope ? t.slope : t.estimate;
  if (est === undefined) return "—";
  const ci =
    t.ci_low !== undefined && t.ci_high !== undefined
      ? ` [${fmtRate(t.ci_low, 3)}, ${fmtRate(t.ci_high, 3)}]`
      : "";
  return `${fmtRate(est, 3)}${ci}`;
}

function renderConfirmatory(dash: Dashboard): string {
  const conf = dash.confirmatory;
  if (!conf || !conf.primary) {
    return `<p class="empty">Confirmatory tests not available.</p>`;
  }
  const tests = ["H1", "H2", "H3", "RQ4"];
  const robust = conf.robust || {};
  const rows = tests
    .map((name) => {
      const t = conf.primary?.[name];
      if (!t) return "";
      const isSlope = name === "H2";
      const pHolm = t.p_holm !== undefined ? fmtRate(t.p_holm, 3) : "—";
      const rob = robust[name];
      const robPill =
        rob === undefined
          ? `<span class="pill">n/a</span>`
          : rob
            ? `<span class="pill yes">robust</span>`
            : `<span class="pill no">not robust</span>`;
      const control = t.control ? ` <span class="page-meta">vs ${t.control}</span>` : "";
      return `<tr>
        <td>${name}${control}</td>
        <td class="num">${fmtTest(t, isSlope)}</td>
        <td class="num">${pHolm}</td>
        <td>${robPill}</td>
      </tr>`;
    })
    .join("");
  return `<div class="table-wrap"><table class="data">
    <thead><tr><th>test</th><th class="num">estimate [CI]</th><th class="num">Holm p</th><th>robust</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

type HealthStatus = "ok" | "watch" | "problem";

function healthStatus(h: Dashboard["health"][number]): {
  status: HealthStatus;
  lengthRate: number | null;
  reason: string;
} {
  const lengthRate =
    h.n_completions > 0 ? h.length_hits / h.n_completions : null;
  if (h.n_errors > 0 || h.n_unparsed > 0) {
    return {
      status: "problem",
      lengthRate,
      reason: h.n_errors > 0 ? "judge API / parse errors" : "unparsed judge outputs",
    };
  }
  // Truncation is common (~10–25%); only flag the extreme tail.
  if (lengthRate !== null && lengthRate >= 0.3) {
    return { status: "watch", lengthRate, reason: "many answers hit the token limit" };
  }
  if (h.n_judge_refused >= 5) {
    return {
      status: "watch",
      lengthRate,
      reason: "secondary judge often refused to grade",
    };
  }
  if (h.n_judge_refused > 0) {
    return { status: "ok", lengthRate, reason: "a few judge refusals (normal)" };
  }
  return { status: "ok", lengthRate, reason: "clean" };
}

function renderHealth(dash: Dashboard): string {
  if (!dash.health.length) return `<p class="empty">No health rows.</p>`;

  const assessed = dash.health.map((h) => ({ h, ...healthStatus(h) }));
  const nProblem = assessed.filter((a) => a.status === "problem").length;
  const nWatch = assessed.filter((a) => a.status === "watch").length;
  const nOk = assessed.length - nProblem - nWatch;

  const summary = `<div class="health-summary">
    <div class="health-pill ok"><strong>${nOk}</strong> fine</div>
    <div class="health-pill watch"><strong>${nWatch}</strong> worth a look</div>
    <div class="health-pill problem"><strong>${nProblem}</strong> real problems</div>
  </div>
  <p class="section-desc" style="margin:0.65rem 0 0.85rem">
    This is a data-quality check, not a safety score. It asks whether judging and generation
    finished cleanly for each checkpoint. Truncation around 0.10–0.25 is normal for long answers;
    only ≥0.30 is flagged. A handful of judge refusals (Llama declining to grade) is also normal.
  </p>`;

  const rows = assessed
    .map(({ h, status, lengthRate, reason }) => {
      const seed =
        h.seed !== null && h.seed !== undefined ? String(h.seed) : "—";
      const statusLabel =
        status === "problem" ? "Problem" : status === "watch" ? "Watch" : "Fine";
      return `<tr class="health-row ${status}">
        <td><code>${h.label}</code></td>
        <td class="num">${seed}</td>
        <td>${h.arm || "—"}</td>
        <td><span class="pill ${status === "ok" ? "yes" : status === "watch" ? "warn" : "no"}">${statusLabel}</span></td>
        <td class="num">${h.n_errors}</td>
        <td class="num">${h.n_judge_refused}</td>
        <td class="num">${h.n_unparsed}</td>
        <td class="num">${fmtRate(lengthRate, 2)}</td>
        <td class="num">${fmtInt(h.n_completions)}</td>
        <td class="muted">${reason}</td>
      </tr>`;
    })
    .join("");

  return `${summary}
    <div class="table-wrap scroll"><table class="data sticky health-table">
      <thead><tr>
        <th>Checkpoint</th>
        <th class="num">Seed</th>
        <th>Arm</th>
        <th>Status</th>
        <th class="num">Judge errors</th>
        <th class="num">Judge refused</th>
        <th class="num">Unparsed</th>
        <th class="num">Hit length limit</th>
        <th class="num">Answers scored</th>
        <th>Note</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <dl class="health-legend">
      <div><dt>Judge errors</dt><dd>The judge call failed or returned unusable JSON.</dd></div>
      <div><dt>Judge refused</dt><dd>The judge model itself declined to grade (usually Llama on a harmful answer). Not a missing file.</dd></div>
      <div><dt>Unparsed</dt><dd>Classifier / SORRY judge could not parse its own output.</dd></div>
      <div><dt>Hit length limit</dt><dd>Share of completions that stopped because they reached the max token budget (truncated).</dd></div>
    </dl>`;
}

function metricOptions(dash: Dashboard, selected: string): string {
  return dash.metric_defs
    .map(
      (m) =>
        `<option value="${m.id}" ${m.id === selected ? "selected" : ""}>${m.label}</option>`,
    )
    .join("");
}

function legendHtml(arms: string[]): string {
  return `<div class="legend">${arms
    .map(
      (a) =>
        `<span><i class="swatch" style="background:${armColor(a)}"></i>${armLabel(a)} (mean; dashed = min/max)</span>`,
    )
    .join("")}</div>`;
}

export function renderOverviewShell(
  mount: HTMLElement,
  catalogue: Catalogue,
  dash: Dashboard,
): void {
  destroyChart(state.charts.gen);
  destroyChart(state.charts.scatter);
  state.charts = { gen: null, scatter: null };
  state.metric = "asr_primary";

  const prompts = catalogue.prompt_counts.total_eval ?? 0;
  const incompleteNote =
    dash.incomplete.length > 0
      ? `${dash.incomplete.length} nodes missing core stages`
      : "all nodes have core stages";
  const maxGen = dash.max_generation ?? 5;

  mount.innerHTML = `
    <nav class="crumb">
      <span class="here">${dash.title}</span>
      <span class="sep">·</span>
      <span>Overview</span>
    </nav>

    <header class="page-header">
      <div>
        <h1 class="page-title">${dash.title}</h1>
        <p class="page-meta">${dash.model ?? "—"} · ${dash.n_nodes} checkpoints · gens 0–${maxGen} · seeds ${
          dash.seeds.length ? dash.seeds.join(", ") : "—"
        }</p>
      </div>
      <div class="controls">
        <a class="btn" href="#/compare">Compare studies</a>
        <a class="btn primary" href="#/${dash.study}/traces?job=harmbench_test&label=G1&seed=0">Browse traces</a>
        <span class="page-meta">${catalogue.exported_at ?? "export unknown"} · indexed ${catalogue.built_at}</span>
      </div>
    </header>

    <div class="glossary">
      <strong>How to read checkpoint labels.</strong> ${GLOSSARY_BLURB}
      <a href="#/labels">Full label map (paper ↔ meaning)</a>
    </div>

    ${
      dash.invalid
        ? `<div class="banner"><strong>Invalid run.</strong> This study diverged (NaN weights); every trained answer is degenerate. Use the valid Qwen replication instead.</div>`
        : ""
    }
    ${
      !dash.has_results
        ? `<div class="banner info"><strong>No paper-side results/ folder for this study.</strong> Charts and headlines below are built from each checkpoint’s metric files instead.</div>`
        : ""
    }
    ${
      maxGen > 5
        ? `<div class="banner info"><strong>Late collapse present.</strong> This export includes Gen 6–${maxGen}. Summary.csv still stops at Gen 5; Gen 10 headlines and jailbreaks are averaged from node metrics.</div>`
        : ""
    }

    <div class="stat-row">
      <div class="stat"><span class="stat-label">Checkpoints</span><div class="stat-value">${fmtInt(dash.n_nodes)}</div></div>
      <div class="stat"><span class="stat-label">Seeds</span><div class="stat-value">${fmtInt(dash.seeds.length || (dash.n_nodes ? 1 : 0))}</div></div>
      <div class="stat"><span class="stat-label">Max gen</span><div class="stat-value">${fmtInt(maxGen)}</div></div>
      <div class="stat"><span class="stat-label">Eval prompts</span><div class="stat-value">${fmtInt(prompts)}</div><span class="stat-note">HB+XS+SORRY</span></div>
      <div class="stat"><span class="stat-label">Arms</span><div class="stat-value" style="font-size:0.95rem">${dash.arms.join(" / ") || "—"}</div></div>
      <div class="stat"><span class="stat-label">Completeness</span><div class="stat-value" style="font-size:0.85rem;font-family:var(--font)">${incompleteNote}</div></div>
    </div>

    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">Where the damage happens</h2>
          <p class="section-desc">
            Same harmful request across generations: refusal → hedge → compliance.
            Numbers below: first fine-tune moves ASR; recursion mainly moves perplexity.
          </p>
        </div>
      </div>
      ${renderAnswerStory()}
      <div style="margin-top:1rem">${renderDeltas(dash.deltas)}</div>
      ${
        dash.study === "main" || dash.study === "base_model"
          ? `<div style="margin-top:1.15rem">
              <h3 class="section-title" style="font-size:1rem;margin-bottom:0.45rem">Replace arm — Gen 1 / 5 / 10</h3>
              ${renderReplacePaperTable(
                dash.study === "main" ? dash.headlines : undefined,
                dash.study === "base_model" ? dash.headlines : undefined,
              )}
              <p class="section-desc" style="margin-top:0.45rem">
                Full IT + Base side-by-side is on <a href="#/compare">Compare</a>.
              </p>
            </div>`
          : ""
      }
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">Key checkpoints</h2>
          <p class="section-desc">ASR from summary.csv when present; late gens from node metrics. PPL and IFEval averaged over seeds.</p>
        </div>
        <a class="btn" href="#/${dash.study}/checkpoints">All checkpoints</a>
      </div>
      ${renderHeadlines(dash)}
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">Generation curves</h2>
          <p class="section-desc">Mean over seeds; dashed lines are min–max. G0 and G1 are shared onto both arms.${
            maxGen > 5 ? " Includes Gen 6–" + maxGen + "." : ""
          }</p>
        </div>
        <div class="controls">
          <label for="metric-select">Metric</label>
          <select id="metric-select">${metricOptions(dash, state.metric)}</select>
        </div>
      </div>
      <div class="chart-frame">
        <div id="gen-chart"></div>
        <div id="gen-legend">${legendHtml(dash.arms)}</div>
      </div>
    </section>

    <section class="section">
      <div class="panel-grid">
        <div class="panel">
          <h3>Safety vs collapse</h3>
          <p class="section-desc" style="margin-bottom:0.65rem">ASR against held-out perplexity. Lines follow each seed’s trajectory.</p>
          <div id="scatter-chart"></div>
          <div class="legend">${dash.arms
            .concat(["shared"])
            .filter((a, i, arr) => arr.indexOf(a) === i)
            .map(
              (a) =>
                `<span><i class="swatch" style="background:${armColor(a)}"></i>${armLabel(a)}</span>`,
            )
            .join("")}</div>
        </div>
        <div class="panel">
          <h3>Does compliance track collapse?</h3>
          <p class="section-desc" style="margin-bottom:0.65rem">Spearman correlation of ASR with held-out perplexity.</p>
          ${renderTracking(dash.tracking)}
          <h3 style="margin-top:1.25rem">Confirmatory tests</h3>
          <p class="section-desc" style="margin-bottom:0.65rem">Planned tests on mean StrongREJECT score (primary).</p>
          ${renderConfirmatory(dash)}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">Late collapse</h2>
          <p class="section-desc">Exploratory Gen 1 / 5–10 — perplexity keeps rising in replace; ASR does not follow.</p>
        </div>
      </div>
      ${renderLateCollapse(dash.late_collapse, dash.arms)}
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">Jailbreaks</h2>
          <p class="section-desc">Primary-judge ASR: plain vs AIM / prefix injection / refusal suppression.</p>
        </div>
      </div>
      ${renderJailbreaks(dash)}
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">Data health</h2>
          <p class="section-desc">Did generation and judging finish cleanly? Not a safety metric.</p>
        </div>
      </div>
      ${renderHealth(dash)}
    </section>
  `;

  const genEl = mount.querySelector<HTMLElement>("#gen-chart")!;
  const scatterEl = mount.querySelector<HTMLElement>("#scatter-chart")!;
  const select = mount.querySelector<HTMLSelectElement>("#metric-select")!;

  const paintGen = () => {
    destroyChart(state.charts.gen);
    const def = dash.metric_defs.find((m) => m.id === state.metric);
    state.charts.gen = mountGenerationChart(
      genEl,
      dash.arms,
      dash.series[state.metric] || {},
      def?.ylab || state.metric,
    );
  };

  paintGen();
  state.charts.scatter = mountScatterChart(scatterEl, dash.scatter);

  select.addEventListener("change", () => {
    state.metric = select.value;
    paintGen();
  });

  const onResize = () => {
    resizeChart(state.charts.gen, genEl);
    resizeChart(state.charts.scatter, scatterEl);
  };
  window.addEventListener("resize", onResize, { passive: true });
}
