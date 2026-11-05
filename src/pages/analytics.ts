import type uPlot from "uplot";
import { fetchCompare } from "../lib/api";
import {
  destroyChart,
  mountCrossStudyChart,
  mountScatterChart,
  resizeChart,
} from "../lib/charts";
import { armColor, fmtPpl, fmtRate } from "../lib/format";
import type { Catalogue, ComparePayload, SeriesPoint } from "../lib/types";

const STUDY_COLOR: Record<string, string> = {
  main: "#c4b5fd",
  base_model: "#f07178",
  replication2: "#60a5fa",
};

type Charts = { asr: uPlot | null; ppl: uPlot | null; scatters: uPlot[] };

const charts: Charts = { asr: null, ppl: null, scatters: [] };

function signed(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}` : s;
}

function armSeries(
  payload: ComparePayload,
  metric: string,
  arm: string,
): { id: string; label: string; color: string; points: SeriesPoint[] }[] {
  return payload.studies
    .map((s) => {
      const pts = s.series?.[metric]?.[arm] || [];
      if (!pts.length) return null;
      return {
        id: s.study,
        label: s.title || s.study,
        color: STUDY_COLOR[s.study] || armColor(arm),
        points: pts,
      };
    })
    .filter(Boolean) as {
    id: string;
    label: string;
    color: string;
    points: SeriesPoint[];
  }[];
}

function renderHeadlineCompare(payload: ComparePayload): string {
  const labels = ["G0", "G1", "R5", "R10"];
  const head = `<tr><th>study</th>${labels.map((l) => `<th class="num">${l} ASR</th><th class="num">${l} PPL</th>`).join("")}<th class="num">ρ</th></tr>`;
  const rows = payload.studies
    .map((s) => {
      const cells = labels
        .map((l) => {
          const h = s.headlines?.[l];
          return `<td class="num">${fmtRate(h?.asr ?? null)}</td><td class="num">${fmtPpl(h?.perplexity ?? null)}</td>`;
        })
        .join("");
      const rho = s.tracking?.levels?.rho;
      return `<tr>
        <td><strong>${s.title}</strong><div class="page-meta">${s.model || ""} · gen≤${s.max_generation ?? 5}</div></td>
        ${cells}
        <td class="num">${fmtRate(rho ?? null, 3)}</td>
      </tr>`;
    })
    .join("");
  return `<div class="table-wrap"><table class="data compact">
    <thead>${head}</thead><tbody>${rows}</tbody>
  </table></div>`;
}

function renderDeltaCompare(payload: ComparePayload): string {
  const ids = ["G0_G1", "G1_R5", "R5_R10"];
  return `<div class="compare-deltas">${payload.studies
    .map((s) => {
      const cards = ids
        .map((id) => {
          const d = (s.deltas || []).find((x) => x.id === id);
          if (!d) return "";
          return `<div class="finding">
            <div class="finding-title">${d.title}</div>
            <div class="finding-metrics">
              <div class="kv"><span>Δ ASR</span><strong>${signed(d.delta_asr)}</strong></div>
              <div class="kv"><span>Δ PPL</span><strong>${signed(d.delta_ppl, 2)}</strong></div>
            </div>
          </div>`;
        })
        .join("");
      return `<div class="compare-col">
        <h3>${s.title}</h3>
        <div class="finding-strip stacked">${cards}</div>
      </div>`;
    })
    .join("")}</div>`;
}

function renderConfCompare(payload: ComparePayload): string {
  const tests = ["H1", "H2", "H3", "RQ4"];
  const head = `<tr><th>study</th>${tests.map((t) => `<th class="num">${t}</th>`).join("")}</tr>`;
  const rows = payload.studies
    .map((s) => {
      const cells = tests
        .map((name) => {
          const t = s.confirmatory?.primary?.[name];
          if (!t) return `<td class="num">—</td>`;
          const est = name === "H2" ? t.slope : t.estimate;
          const rob = s.confirmatory?.robust?.[name];
          const mark =
            rob === true ? " ✓" : rob === false ? "" : name === "RQ4" ? "" : "";
          return `<td class="num" title="Holm p ${fmtRate(t.p_holm ?? null, 3)}">${fmtRate(est ?? null, 3)}${mark}</td>`;
        })
        .join("");
      return `<tr><td>${s.title}</td>${cells}</tr>`;
    })
    .join("");
  return `<div class="table-wrap"><table class="data">
    <thead>${head}</thead><tbody>${rows}</tbody>
  </table></div>
  <p class="section-desc" style="margin-top:0.5rem">✓ = robust under ambiguity treatments and secondary judge. RQ4 is over-refusal (not a collapse hypothesis).</p>`;
}

export async function renderAnalyticsPage(
  mount: HTMLElement,
  _catalogue: Catalogue,
): Promise<void> {
  destroyChart(charts.asr);
  destroyChart(charts.ppl);
  charts.scatters.forEach(destroyChart);
  charts.asr = null;
  charts.ppl = null;
  charts.scatters = [];

  mount.innerHTML = `<div class="status">Loading compare…</div>`;
  let payload: ComparePayload;
  try {
    payload = await fetchCompare();
  } catch (err) {
    mount.innerHTML = `<div class="status error">${
      err instanceof Error ? err.message : String(err)
    }</div>`;
    return;
  }

  mount.innerHTML = `
    <nav class="crumb">
      <span class="here">Compare</span>
      <span class="sep">·</span>
      <span>IT · Base · Qwen</span>
    </nav>
    <header class="page-header">
      <div>
        <h1 class="page-title">Cross-study analytics</h1>
        <p class="page-meta">${payload.finding}</p>
      </div>
    </header>

    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">Headline numbers</h2>
          <p class="section-desc">Same protocol across categories. ρ is Spearman ASR ↔ held-out perplexity.</p>
        </div>
      </div>
      ${renderHeadlineCompare(payload)}
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">Damage locations</h2>
          <p class="section-desc">Δ ASR vs Δ perplexity at the paper’s key transitions.</p>
        </div>
      </div>
      ${renderDeltaCompare(payload)}
    </section>

    <section class="section">
      <div class="panel-grid">
        <div class="panel">
          <h3>Replace ASR across studies</h3>
          <p class="section-desc" style="margin-bottom:0.65rem">Mean primary-judge ASR on the collapse arm.</p>
          <div id="x-asr"></div>
          <div class="legend" id="x-asr-legend"></div>
        </div>
        <div class="panel">
          <h3>Replace perplexity across studies</h3>
          <p class="section-desc" style="margin-bottom:0.65rem">Held-out perplexity — the collapse measure.</p>
          <div id="x-ppl"></div>
          <div class="legend" id="x-ppl-legend"></div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">Confirmatory tests</h2>
          <p class="section-desc">Primary judge, family-wise Holm control within each category.</p>
        </div>
      </div>
      ${renderConfCompare(payload)}
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">ASR × perplexity by study</h2>
          <p class="section-desc">Each point is one checkpoint; lines follow a seed.</p>
        </div>
      </div>
      <div class="scatter-row" id="scatter-row"></div>
    </section>
  `;

  const asrSeries = armSeries(payload, "asr_primary", "replace");
  const pplSeries = armSeries(payload, "perplexity", "replace");
  const asrEl = mount.querySelector<HTMLElement>("#x-asr")!;
  const pplEl = mount.querySelector<HTMLElement>("#x-ppl")!;
  charts.asr = mountCrossStudyChart(asrEl, asrSeries, "ASR");
  charts.ppl = mountCrossStudyChart(pplEl, pplSeries, "PPL");

  const legend = (id: string, series: typeof asrSeries) => {
    const el = mount.querySelector(`#${id}`)!;
    el.innerHTML = series
      .map((s) => `<span><i class="swatch" style="background:${s.color}"></i>${s.label}</span>`)
      .join("");
  };
  legend("x-asr-legend", asrSeries);
  legend("x-ppl-legend", pplSeries);

  const row = mount.querySelector<HTMLElement>("#scatter-row")!;
  row.innerHTML = payload.studies
    .map(
      (s) => `<div class="panel">
        <h3>${s.title}</h3>
        <div id="sc-${s.study}"></div>
      </div>`,
    )
    .join("");
  for (const s of payload.studies) {
    const el = mount.querySelector<HTMLElement>(`#sc-${s.study}`)!;
    charts.scatters.push(mountScatterChart(el, s.scatter || []));
  }

  const onResize = () => {
    resizeChart(charts.asr, asrEl);
    resizeChart(charts.ppl, pplEl);
    payload.studies.forEach((s, i) => {
      const el = mount.querySelector<HTMLElement>(`#sc-${s.study}`);
      if (el) resizeChart(charts.scatters[i] || null, el);
    });
  };
  window.addEventListener("resize", onResize, { passive: true });
}
