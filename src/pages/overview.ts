import type uPlot from "uplot";
import {
  destroyChart,
  mountGenerationChart,
  mountScatterChart,
  resizeChart,
} from "../lib/charts";
import { armColor, armLabel, fmtInt, fmtPpl, fmtRate } from "../lib/format";
import { explainLabel, GLOSSARY_BLURB } from "../lib/glossary";
import type { Catalogue, ConfirmatoryTest, Dashboard } from "../lib/types";

type OverviewState = {
  metric: string;
  charts: { gen: uPlot | null; scatter: uPlot | null };
};

const state: OverviewState = {
  metric: "asr_primary",
  charts: { gen: null, scatter: null },
};

function headlineOrder(dash: Dashboard): string[] {
  const preferred = ["G0", "G1", "R5", "S5", "A5", "R10", "S10"];
  return preferred.filter((k) => dash.headlines[k]);
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
      return `<article class="headline${emphasis}" title="${explainLabel(label).replaceAll('"', "&quot;")}">
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
        }</span></div>
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
      return `<tr>
        <td>${name}</td>
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

function renderHealth(dash: Dashboard): string {
  if (!dash.health.length) return `<p class="empty">No health rows.</p>`;
  return `<div class="health-strip">${dash.health
    .map((h) => {
      const bad = h.n_errors > 0 || h.n_unparsed > 0;
      const warn = !bad && (h.n_judge_refused > 0 || h.length_hits > 50);
      const cls = bad ? "bad" : warn ? "warn" : "";
      const lengthRate =
        h.n_completions > 0 ? h.length_hits / h.n_completions : null;
      return `<div class="health-cell ${cls}">
        <div class="id">${h.label}${h.seed !== null && h.seed !== undefined ? `·s${h.seed}` : ""}</div>
        <div class="vals">err ${h.n_errors} · jr ${h.n_judge_refused}<br/>len ${fmtRate(lengthRate, 2)}</div>
      </div>`;
    })
    .join("")}</div>
    <p class="section-desc" style="margin-top:0.65rem">err = judge errors · jr = judge refusals · len = share of answers hitting the token limit</p>`;
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

  mount.innerHTML = `
    <nav class="crumb">
      <span class="here">${dash.title}</span>
      <span class="sep">·</span>
      <span>Overview</span>
    </nav>

    <header class="page-header">
      <div>
        <h1 class="page-title">${dash.title}</h1>
        <p class="page-meta">${dash.model ?? "—"} · ${dash.n_nodes} checkpoints · seeds ${
          dash.seeds.length ? dash.seeds.join(", ") : "—"
        }</p>
      </div>
      <div class="controls">
        <a class="btn primary" href="#/${dash.study}/traces?job=harmbench_test&label=G1&seed=0">Browse traces</a>
        <span class="page-meta">${catalogue.exported_at ?? "export unknown"} · indexed ${catalogue.built_at}</span>
      </div>
    </header>

    <div class="glossary">
      <strong>How to read checkpoint labels.</strong> ${GLOSSARY_BLURB}
      Hover a G0/G1/R5/S5 card for the full definition.
    </div>

    ${
      dash.invalid
        ? `<div class="banner"><strong>Invalid run.</strong> This study diverged (NaN weights); every trained answer is degenerate. Use the valid Qwen replication instead.</div>`
        : ""
    }
    ${
      !dash.has_results
        ? `<div class="banner"><strong>No results/ aggregates.</strong> Curves below are computed from per-node metric files.</div>`
        : ""
    }

    <div class="stat-row">
      <div class="stat"><span class="stat-label">Checkpoints</span><div class="stat-value">${fmtInt(dash.n_nodes)}</div></div>
      <div class="stat"><span class="stat-label">Seeds</span><div class="stat-value">${fmtInt(dash.seeds.length || (dash.n_nodes ? 1 : 0))}</div></div>
      <div class="stat"><span class="stat-label">Eval prompts</span><div class="stat-value">${fmtInt(prompts)}</div><span class="stat-note">HB+XS+SORRY</span></div>
      <div class="stat"><span class="stat-label">Primary judge calls</span><div class="stat-value">${fmtInt(catalogue.judge_calls_primary)}</div><span class="stat-note">all studies</span></div>
      <div class="stat"><span class="stat-label">Arms</span><div class="stat-value" style="font-size:0.95rem">${dash.arms.join(" / ") || "—"}</div></div>
      <div class="stat"><span class="stat-label">Completeness</span><div class="stat-value" style="font-size:0.85rem;font-family:var(--font)">${incompleteNote}</div></div>
    </div>

    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">Key checkpoints</h2>
          <p class="section-desc">ASR from summary.csv (primary judge); PPL and IFEval averaged over seeds.</p>
        </div>
      </div>
      ${renderHeadlines(dash)}
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">Generation curves</h2>
          <p class="section-desc">Mean over seeds; dashed lines are min–max. G0 and G1 are shared onto both arms.</p>
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
          <h3>Confirmatory tests</h3>
          <p class="section-desc" style="margin-bottom:0.65rem">Planned tests on mean StrongREJECT score (primary).</p>
          ${renderConfirmatory(dash)}
        </div>
      </div>
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
          <p class="section-desc">Silent failures at a glance. Highlighted cells have errors or many truncations.</p>
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
