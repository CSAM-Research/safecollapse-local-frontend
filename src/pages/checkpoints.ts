import { fetchDashboard } from "../lib/api";
import { armColor, armLabel, fmtPpl, fmtRate } from "../lib/format";
import { explainLabel, shortArmName } from "../lib/glossary";
import type { Catalogue, DashNode, Dashboard } from "../lib/types";

export type CheckpointRoute =
  | { study: string; nodeId?: undefined }
  | { study: string; nodeId: string };

export function parseCheckpointRoute(hash: string): CheckpointRoute | null {
  const m = /^#\/([^/]+)\/checkpoints(?:\/([^/?#]+))?/.exec(hash);
  if (!m) return null;
  const study = m[1]!;
  const nodeId = m[2] ? decodeURIComponent(m[2]) : undefined;
  return nodeId ? { study, nodeId } : { study };
}

function metricCell(v: number | null | undefined, kind: "rate" | "ppl" = "rate"): string {
  return kind === "ppl" ? fmtPpl(v ?? null) : fmtRate(v ?? null);
}

function renderTable(dash: Dashboard, nodes: DashNode[]): string {
  if (!nodes.length) return `<p class="empty">No checkpoints indexed.</p>`;
  const rows = nodes
    .map((n) => {
      const m = n.metrics || {};
      return `<tr data-node="${n.node_id.replaceAll('"', "")}">
        <td><a href="#/${dash.study}/checkpoints/${encodeURIComponent(n.node_id)}">${n.label}</a></td>
        <td>${n.seed ?? "—"}</td>
        <td><span class="arm-dot" style="background:${armColor(n.arm || "shared")}"></span>${armLabel(n.arm || "shared")}</td>
        <td class="num">${n.generation}</td>
        <td class="num">${metricCell(m.asr_primary as number | null)}</td>
        <td class="num">${metricCell(m.perplexity as number | null, "ppl")}</td>
        <td class="num">${metricCell(m.over_refusal as number | null)}</td>
        <td class="num">${metricCell(m.ifeval as number | null)}</td>
        <td class="num">${metricCell(m.sorry_fulfillment as number | null)}</td>
        <td class="num">${(n.stages || []).length}</td>
      </tr>`;
    })
    .join("");
  return `<div class="table-wrap scroll"><table class="data sticky">
    <thead><tr>
      <th>label</th><th>seed</th><th>arm</th><th class="num">gen</th>
      <th class="num">ASR</th><th class="num">PPL</th><th class="num">over-ref.</th>
      <th class="num">IFEval</th><th class="num">SORRY</th><th class="num">stages</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function kvBlock(title: string, pairs: [string, string][]): string {
  return `<div class="meta-block">
    <div class="meta-block-title">${title}</div>
    <dl class="kv-list">${pairs
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
      .join("")}</dl>
  </div>`;
}

function renderDetail(dash: Dashboard, node: DashNode): string {
  const m = node.metrics || {};
  const metricPairs: [string, string][] = [
    ["ASR (primary)", metricCell(m.asr_primary as number | null)],
    ["ASR (secondary)", metricCell(m.asr_secondary as number | null)],
    ["Mean score", metricCell(m.mean_score as number | null)],
    ["Refusal rate", metricCell(m.refusal_rate as number | null)],
    ["Over-refusal", metricCell(m.over_refusal as number | null)],
    ["SORRY fulfilment", metricCell(m.sorry_fulfillment as number | null)],
    ["Classifier ASR", metricCell(m.classifier_asr as number | null)],
    ["Perplexity", metricCell(m.perplexity as number | null, "ppl")],
    ["IFEval", metricCell(m.ifeval as number | null)],
    ["Tail-loss share", metricCell(m.tail_loss as number | null)],
    ["JB AIM", metricCell(m.jb_aim as number | null)],
    ["JB prefix", metricCell(m.jb_prefix as number | null)],
    ["JB refusal-supp.", metricCell(m.jb_refusal as number | null)],
    ["@robust ASR", metricCell(m.robust as number | null)],
  ];
  const stages = (node.stages || []).map((s) => `<li><code>${s}</code></li>`).join("") || "<li>—</li>";
  const train = node.train_stats
    ? kvBlock(
        "Training",
        Object.entries(node.train_stats)
          .filter(([, v]) => typeof v !== "object")
          .map(([k, v]) => [k, String(v)]),
      )
    : "";

  return `
    <div class="detail-grid">
      ${kvBlock("Identity", [
        ["node", node.node_id],
        ["label", `${node.label} — ${explainLabel(node.label)}`],
        ["arm", shortArmName(node.arm)],
        ["seed", node.seed === null || node.seed === undefined ? "—" : String(node.seed)],
        ["generation", String(node.generation)],
        ["path", node.rel_path],
        ["train.jsonl", node.has_train ? "yes" : "no"],
        ["synthetic.jsonl", node.has_synthetic ? "yes" : "no"],
      ])}
      ${kvBlock("Metrics", metricPairs)}
      ${train}
      <div class="meta-block">
        <div class="meta-block-title">Stages (.done)</div>
        <ul class="stage-list">${stages}</ul>
      </div>
    </div>
    <div class="controls" style="margin-top:1rem">
      <a class="btn primary" href="#/${dash.study}/traces?job=harmbench_test&label=${encodeURIComponent(node.label)}${
        node.seed !== null && node.seed !== undefined ? `&seed=${node.seed}` : ""
      }">Open traces</a>
      <a class="btn" href="#/${dash.study}/checkpoints">← All checkpoints</a>
    </div>
  `;
}

export async function renderCheckpointsPage(
  mount: HTMLElement,
  catalogue: Catalogue,
  route: CheckpointRoute,
): Promise<void> {
  mount.innerHTML = `<div class="status">Loading checkpoints…</div>`;
  let dash: Dashboard;
  try {
    dash = await fetchDashboard(route.study);
  } catch (err) {
    mount.innerHTML = `<div class="status error">${
      err instanceof Error ? err.message : String(err)
    }</div>`;
    return;
  }

  const studyMeta = catalogue.studies.find((s) => s.id === route.study);
  const nodes = dash.nodes || [];
  const selected = route.nodeId ? nodes.find((n) => n.node_id === route.nodeId) : undefined;

  if (route.nodeId && !selected) {
    mount.innerHTML = `<div class="status error">Checkpoint not found: ${route.nodeId}</div>`;
    return;
  }

  mount.innerHTML = `
    <nav class="crumb">
      <a href="#/${route.study}">${studyMeta?.title || route.study}</a>
      <span class="sep">/</span>
      <a href="#/${route.study}/checkpoints">Checkpoints</a>
      ${selected ? `<span class="sep">/</span><span class="here">${selected.label}</span>` : ""}
    </nav>
    <header class="page-header">
      <div>
        <h1 class="page-title">${selected ? selected.label : "Checkpoints"}</h1>
        <p class="page-meta">${
          selected
            ? `${selected.node_id} · ${shortArmName(selected.arm)}`
            : `${nodes.length} nodes · click a row for detail`
        }</p>
      </div>
      <div class="controls">
        <a class="btn" href="#/${route.study}">Overview</a>
        <a class="btn" href="#/${route.study}/traces?job=harmbench_test&label=G1&seed=0">Traces</a>
      </div>
    </header>
    ${selected ? renderDetail(dash, selected) : renderTable(dash, nodes)}
  `;
}
