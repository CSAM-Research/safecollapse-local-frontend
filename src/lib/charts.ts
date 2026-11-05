import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { armColor } from "./format";
import type { ScatterPoint, SeriesPoint } from "./types";

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function axisStyle(): { stroke: string; grid: uPlot.Axis.Grid; ticks: uPlot.Axis.Ticks; font: string } {
  const text = cssVar("--text-muted", "#6b6b63");
  const grid = cssVar("--border", "#d9d9d2");
  return {
    stroke: text,
    grid: { stroke: grid, width: 1 },
    ticks: { stroke: grid, width: 1 },
    font: "11px var(--mono)",
  };
}

export function destroyChart(chart: uPlot | null): void {
  chart?.destroy();
}

function emptyMessage(el: HTMLElement, msg: string): uPlot {
  el.innerHTML = `<p class="empty">${msg}</p>`;
  return new uPlot(
    {
      width: Math.max(280, el.clientWidth || 480),
      height: 40,
      legend: { show: false },
      series: [{}],
    },
    [[]],
    el,
  );
}

/** Generation curves: mean line per arm + dashed min/max. */
export function mountGenerationChart(
  el: HTMLElement,
  arms: string[],
  seriesByArm: Record<string, SeriesPoint[]>,
  ylab: string,
): uPlot {
  el.replaceChildren();
  const gens = new Set<number>();
  for (const arm of arms) {
    for (const p of seriesByArm[arm] || []) gens.add(p.generation);
  }
  const xs = [...gens].sort((a, b) => a - b);
  if (xs.length === 0) return emptyMessage(el, "No data for this metric.");

  const data: uPlot.AlignedData = [xs];
  const series: uPlot.Series[] = [{}];

  for (const arm of arms) {
    const byGen = new Map((seriesByArm[arm] || []).map((p) => [p.generation, p]));
    const mean = xs.map((g) => byGen.get(g)?.mean ?? null);
    const lo = xs.map((g) => byGen.get(g)?.min ?? null);
    const hi = xs.map((g) => byGen.get(g)?.max ?? null);
    const color = armColor(arm);
    data.push(lo, hi, mean);
    series.push(
      {
        label: `${arm} min`,
        stroke: color,
        width: 1,
        dash: [4, 3],
        alpha: 0.45,
        points: { show: false },
      },
      {
        label: `${arm} max`,
        stroke: color,
        width: 1,
        dash: [4, 3],
        alpha: 0.45,
        points: { show: false },
      },
      {
        label: arm,
        stroke: color,
        width: 2.25,
        points: {
          show: true,
          size: 7,
          fill: cssVar("--bg-elevated", "#fff"),
          stroke: color,
          width: 2,
        },
      },
    );
  }

  const width = Math.max(320, el.clientWidth || 640);
  const ax = axisStyle();
  return new uPlot(
    {
      width,
      height: 300,
      pxAlign: false,
      cursor: { drag: { x: false, y: false } },
      legend: { show: false },
      series,
      scales: { x: { time: false } },
      axes: [
        { ...ax, label: "generation", values: (_u, splits) => splits.map(String) },
        { ...ax, label: ylab, size: 56 },
      ],
    },
    data,
    el,
  );
}

export function mountScatterChart(el: HTMLElement, points: ScatterPoint[]): uPlot {
  el.replaceChildren();
  if (points.length === 0) return emptyMessage(el, "No ASR × perplexity points.");

  // Sort by perplexity so uPlot is happy; keep arm series aligned.
  const sorted = [...points].sort((a, b) => a.perplexity - b.perplexity);
  const arms = [...new Set(sorted.map((p) => p.arm))];
  const xs = sorted.map((p) => p.perplexity);
  const data: uPlot.AlignedData = [xs];
  const series: uPlot.Series[] = [{}];

  for (const arm of arms) {
    data.push(sorted.map((p) => (p.arm === arm ? p.asr : null)));
    const color = armColor(arm);
    series.push({
      label: arm,
      stroke: color,
      width: 1,
      paths: () => null,
      points: {
        show: true,
        size: 7,
        fill: color,
        stroke: cssVar("--bg-elevated", "#fff"),
        width: 1,
      },
    });
  }

  const bySeedArm = new Map<string, ScatterPoint[]>();
  for (const p of points) {
    const key = `${p.arm}:${p.seed ?? "none"}`;
    const list = bySeedArm.get(key) || [];
    list.push(p);
    bySeedArm.set(key, list);
  }
  for (const list of bySeedArm.values()) {
    list.sort((a, b) => a.generation - b.generation);
  }

  const width = Math.max(280, el.clientWidth || 480);
  const ax = axisStyle();
  return new uPlot(
    {
      width,
      height: 300,
      pxAlign: false,
      cursor: { drag: { x: false, y: false } },
      legend: { show: false },
      series,
      scales: { x: { time: false } },
      axes: [
        { ...ax, label: "held-out perplexity" },
        { ...ax, label: "ASR", size: 56 },
      ],
      hooks: {
        draw: [
          (u) => {
            const ctx = u.ctx;
            ctx.save();
            ctx.lineWidth = 1;
            for (const [key, list] of bySeedArm) {
              if (list.length < 2) continue;
              const arm = key.split(":")[0] ?? "shared";
              ctx.strokeStyle = armColor(arm);
              ctx.globalAlpha = 0.35;
              ctx.beginPath();
              list.forEach((p, i) => {
                const x = u.valToPos(p.perplexity, "x", true);
                const y = u.valToPos(p.asr, "y", true);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              });
              ctx.stroke();
            }
            ctx.restore();
          },
        ],
      },
    },
    data,
    el,
  );
}

export type TraceTimelinePoint = {
  label: string;
  arm: string | null;
  generation: number;
  judges: Record<string, { score?: number | null }>;
};

function primaryScore(judges: Record<string, { score?: number | null }>): number | null {
  const j = judges.gpt4o_mini || judges.sorry_judge || Object.values(judges)[0];
  const s = j?.score;
  if (s === null || s === undefined || Number.isNaN(Number(s))) return null;
  return Number(s);
}

/**
 * Compact per-prompt chart: primary-judge score vs generation, one line per arm.
 * G0/G1 are drawn on every arm line (shared stem).
 * Semi-transparent strokes + dashed/solid so overlaps stay readable.
 */
export function mountTraceScoreChart(el: HTMLElement, timeline: TraceTimelinePoint[]): uPlot {
  el.replaceChildren();
  if (!timeline.length) return emptyMessage(el, "No generation scores for this prompt.");

  const shared = new Map<number, number>();
  const byArm = new Map<string, Map<number, number>>();

  for (const t of timeline) {
    const score = primaryScore(t.judges);
    if (score === null) continue;
    const arm = t.arm;
    if (t.generation <= 1 || arm === "shared" || arm === "base" || arm == null) {
      shared.set(t.generation, score);
      continue;
    }
    if (!byArm.has(arm)) byArm.set(arm, new Map());
    byArm.get(arm)!.set(t.generation, score);
  }

  const arms = [...byArm.keys()].sort();
  if (arms.length === 0 && shared.size > 0) {
    byArm.set("shared", new Map(shared));
    arms.push("shared");
  } else {
    for (const arm of arms) {
      const m = byArm.get(arm)!;
      for (const [g, v] of shared) m.set(g, v);
    }
  }

  const gens = new Set<number>();
  for (const m of byArm.values()) for (const g of m.keys()) gens.add(g);
  for (const g of shared.keys()) gens.add(g);
  const xs = [...gens].sort((a, b) => a - b);
  if (xs.length === 0) return emptyMessage(el, "No scored checkpoints for this prompt.");

  const plotArms = arms.length ? arms : ["shared"];
  const data: uPlot.AlignedData = [xs];
  const series: uPlot.Series[] = [{}];

  plotArms.forEach((arm, index) => {
    const m = byArm.get(arm) || shared;
    const ys = xs.map((g) => m.get(g) ?? null);
    const color = armColor(arm === "shared" ? "shared" : arm);
    const dashed = index % 2 === 1;
    data.push(ys);
    series.push({
      label: arm,
      stroke: color,
      width: 2.75,
      // Let both colours show through when lines coincide.
      alpha: 0.72,
      dash: dashed ? [7, 4] : undefined,
      points: {
        show: true,
        size: dashed ? 9 : 7,
        fill: dashed ? cssVar("--bg-elevated", "#111") : color,
        stroke: color,
        width: 2,
        // Points a bit more opaque than the stroke so markers stay crisp.
      },
    });
  });

  const width = Math.max(240, el.clientWidth || 480);
  const ax = axisStyle();
  const xMin = xs[0]! - 0.35;
  const xMax = xs[xs.length - 1]! + 0.35;

  const chart = new uPlot(
    {
      width,
      height: 200,
      pxAlign: false,
      cursor: { drag: { x: false, y: false } },
      legend: { show: false },
      series,
      scales: {
        x: {
          time: false,
          range: () => [xMin, xMax],
        },
        y: { auto: false, min: -0.02, max: 1.02 },
      },
      axes: [
        {
          ...ax,
          label: "generation",
          incrs: [1],
          values: (_u, splits) =>
            splits.map((v) => (Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : "")),
          space: 28,
        },
        {
          ...ax,
          label: "score",
          size: 48,
          values: (_u, splits) => splits.map((v) => v.toFixed(1)),
        },
      ],
      hooks: {
        draw: [
          (u) => {
            const y = u.valToPos(0.5, "y", true);
            const ctx = u.ctx;
            ctx.save();
            ctx.strokeStyle = cssVar("--text-faint", "#6b6b6b");
            ctx.setLineDash([3, 3]);
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.75;
            ctx.beginPath();
            ctx.moveTo(u.bbox.left, y);
            ctx.lineTo(u.bbox.left + u.bbox.width, y);
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
    },
    data,
    el,
  );

  const legend = document.createElement("div");
  legend.className = "legend compact";
  legend.innerHTML =
    plotArms
      .map((a, i) => {
        const dashed = i % 2 === 1;
        return `<span><i class="swatch" style="background:${armColor(
          a === "shared" ? "shared" : a,
        )};opacity:0.85"></i>${a}${dashed ? " (dashed)" : ""}</span>`;
      })
      .join("") + `<span class="muted">grey dashed = ASR 0.5</span>`;
  el.appendChild(legend);
  return chart;
}

export function resizeChart(chart: uPlot | null, el: HTMLElement): void {
  if (!chart) return;
  chart.setSize({ width: Math.max(280, el.clientWidth), height: chart.height });
}

/** Overlay one metric across studies for a single arm (mean over seeds). */
export function mountCrossStudyChart(
  el: HTMLElement,
  series: { id: string; label: string; color: string; points: SeriesPoint[] }[],
  ylab: string,
): uPlot {
  el.replaceChildren();
  const gens = new Set<number>();
  for (const s of series) for (const p of s.points) gens.add(p.generation);
  const xs = [...gens].sort((a, b) => a - b);
  if (xs.length === 0) return emptyMessage(el, "No cross-study series.");

  const data: uPlot.AlignedData = [xs];
  const uSeries: uPlot.Series[] = [{}];
  for (const s of series) {
    const byGen = new Map(s.points.map((p) => [p.generation, p.mean]));
    data.push(xs.map((g) => byGen.get(g) ?? null));
    uSeries.push({
      label: s.label,
      stroke: s.color,
      width: 2.25,
      points: {
        show: true,
        size: 6,
        fill: cssVar("--bg-elevated", "#111"),
        stroke: s.color,
        width: 2,
      },
    });
  }

  const width = Math.max(280, el.clientWidth || 480);
  const ax = axisStyle();
  return new uPlot(
    {
      width,
      height: 260,
      pxAlign: false,
      cursor: { drag: { x: false, y: false } },
      legend: { show: false },
      series: uSeries,
      scales: { x: { time: false } },
      axes: [
        {
          ...ax,
          label: "generation",
          incrs: [1],
          values: (_u, splits) =>
            splits.map((v) => (Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : "")),
        },
        { ...ax, label: ylab, size: 56 },
      ],
    },
    data,
    el,
  );
}
