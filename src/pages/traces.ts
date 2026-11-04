import type uPlot from "uplot";
import {
  fetchAcross,
  fetchNodes,
  fetchTrace,
  fetchTraces,
  type AcrossResponse,
  type NodesResponse,
  type TraceDetail,
  type TraceListResponse,
} from "../lib/api";
import { destroyChart, mountTraceScoreChart, resizeChart } from "../lib/charts";
import { fmtRate } from "../lib/format";
import { explainLabel, GLOSSARY_BLURB, shortArmName } from "../lib/glossary";
import type { Catalogue } from "../lib/types";

export type TraceRoute = {
  study: string;
  view: "list" | "detail";
  job: string;
  label: string;
  seed: number | null;
  prompt?: string;
  sample: number;
};

const JOB_LABELS: Record<string, string> = {
  harmbench_test: "HarmBench (plain)",
  "harmbench_test@robust": "HarmBench @robust",
  "harmbench_test@jb_aim": "Jailbreak: AIM",
  "harmbench_test@jb_prefix_injection": "Jailbreak: prefix injection",
  "harmbench_test@jb_refusal_suppression": "Jailbreak: refusal suppression",
  xstest_safe: "XSTest (safe)",
  sorry_bench: "SORRY-Bench",
};

/** Optional blur — off by default per author request. */
let hideAnswers = false;

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function scoreCell(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const harmful = v > 0.5;
  return `<span class="score ${harmful ? "bad" : ""}">${fmtRate(v)}</span>`;
}

function buildHash(route: TraceRoute): string {
  const sp = new URLSearchParams();
  sp.set("job", route.job);
  sp.set("label", route.label);
  if (route.seed !== null && route.seed !== undefined && route.label !== "G0") {
    sp.set("seed", String(route.seed));
  }
  if (route.sample) sp.set("sample", String(route.sample));
  if (route.view === "detail" && route.prompt) {
    sp.set("prompt", route.prompt);
    return `#/${route.study}/trace?${sp.toString()}`;
  }
  return `#/${route.study}/traces?${sp.toString()}`;
}

export function parseTraceRoute(hash: string): TraceRoute | null {
  const raw = hash.replace(/^#\/?/, "");
  const [pathPart, queryPart = ""] = raw.split("?");
  const parts = pathPart.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const study = parts[0]!;
  const viewName = parts[1]!;
  if (viewName !== "traces" && viewName !== "trace") return null;
  const sp = new URLSearchParams(queryPart);
  const seedRaw = sp.get("seed");
  return {
    study,
    view: viewName === "trace" ? "detail" : "list",
    job: sp.get("job") || "harmbench_test",
    label: sp.get("label") || "G1",
    seed: seedRaw === null || seedRaw === "" ? 0 : Number(seedRaw),
    prompt: sp.get("prompt") || undefined,
    sample: Number(sp.get("sample") || 0),
  };
}

function uniqueLabels(nodes: NodesResponse["nodes"]): string[] {
  const labels = [...new Set(nodes.map((n) => n.label))];
  const order = (l: string) => {
    const m = /^([GSRA])(\d+)$/.exec(l);
    if (!m) return [99, 0] as const;
    const armOrder = { G: 0, R: 1, S: 2, A: 3 }[m[1] as "G" | "R" | "S" | "A"] ?? 9;
    return [armOrder, Number(m[2])] as const;
  };
  return labels.sort((a, b) => {
    const [aa, ag] = order(a);
    const [ba, bg] = order(b);
    return aa - ba || ag - bg;
  });
}

function seedsForLabel(nodes: NodesResponse["nodes"], label: string): (number | null)[] {
  if (label === "G0") return [null];
  const seeds = [
    ...new Set(
      nodes.filter((n) => n.label === label && n.seed !== null).map((n) => n.seed as number),
    ),
  ].sort((a, b) => a - b);
  return seeds.length ? seeds : [0];
}

function answerBlock(
  text: string | null | undefined,
  flags?: { truncated?: boolean; empty?: boolean; repetition?: boolean },
  idSuffix = "",
  compact = false,
): string {
  const available = text !== null && text !== undefined;
  if (!available) return `<p class="empty">Answer not available on disk.</p>`;
  const notes = [
    flags?.truncated ? "truncated" : "",
    flags?.empty ? "empty" : "",
    flags?.repetition ? "repetition" : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const collapsed = hideAnswers;
  return `
    <div class="answer-block" data-answer-id="${idSuffix}">
      ${
        compact
          ? ""
          : `<div class="answer-toolbar">
        <button type="button" class="btn ghost" data-reveal="${idSuffix}">${
          collapsed ? "Show answer" : "Hide answer"
        }</button>
        ${notes ? `<span class="muted">${escapeHtml(notes)}</span>` : ""}
      </div>`
      }
      <pre class="answer-text ${collapsed ? "is-collapsed" : ""}">${escapeHtml(text)}</pre>
    </div>
  `;
}

const LONG_META_KEYS = new Set(["context", "behavior", "prompt", "text", "code"]);

/** Professional meta rendering: short fields as rows; long fields as code blocks. */
function renderPromptMeta(meta: Record<string, unknown>): string {
  const entries = Object.entries(meta).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  if (!entries.length) return "";

  const short: [string, string][] = [];
  const long: [string, string][] = [];
  for (const [k, v] of entries) {
    const s = String(v);
    if (LONG_META_KEYS.has(k) || s.length > 80 || s.includes("\n")) long.push([k, s]);
    else short.push([k, s]);
  }

  const shortHtml = short.length
    ? `<div class="kv-list">${short
        .map(
          ([k, v]) =>
            `<div class="kv-row"><div class="k">${escapeHtml(k)}</div><div class="v left">${escapeHtml(
              v,
            )}</div></div>`,
        )
        .join("")}</div>`
    : "";

  const longHtml = long
    .map(
      ([k, v]) => `
      <div class="meta-block">
        <div class="meta-block-head">${escapeHtml(k)}</div>
        <pre class="meta-block-body">${escapeHtml(v)}</pre>
      </div>`,
    )
    .join("");

  return `${shortHtml}${longHtml}`;
}

function primaryScoreFromRow(row: {
  judges: Record<string, { score?: number | null }>;
}): number | null {
  const j =
    row.judges.gpt4o_mini || row.judges.sorry_judge || Object.values(row.judges)[0];
  const s = j?.score;
  return s === null || s === undefined || Number.isNaN(Number(s)) ? null : Number(s);
}

function wireReveal(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>("[data-reveal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.reveal || "";
      const block = root.querySelector(`[data-answer-id="${id}"]`);
      const pre = block?.querySelector(".answer-text");
      if (!pre) return;
      const nowCollapsed = !pre.classList.contains("is-collapsed");
      pre.classList.toggle("is-collapsed", nowCollapsed);
      btn.textContent = nowCollapsed ? "Show answer" : "Hide answer";
    });
  });
}

function syncHideToggle(root: HTMLElement): void {
  root.querySelectorAll(".answer-text").forEach((pre) => {
    pre.classList.toggle("is-collapsed", hideAnswers);
  });
  root.querySelectorAll<HTMLButtonElement>("[data-reveal]").forEach((btn) => {
    btn.textContent = hideAnswers ? "Show answer" : "Hide answer";
  });
}

async function renderList(
  mount: HTMLElement,
  catalogue: Catalogue,
  route: TraceRoute,
  nodesInfo: NodesResponse,
): Promise<void> {
  const labels = uniqueLabels(nodesInfo.nodes);
  if (!labels.includes(route.label) && labels.length) {
    route.label = labels.includes("G1") ? "G1" : labels[0]!;
  }
  const seeds = seedsForLabel(nodesInfo.nodes, route.label);
  if (route.label === "G0") route.seed = null;
  else if (route.seed === null || !seeds.includes(route.seed)) route.seed = (seeds[0] as number) ?? 0;

  const jobs = nodesInfo.jobs.length
    ? nodesInfo.jobs
    : ["harmbench_test", "xstest_safe", "sorry_bench"];

  const studyTitle =
    catalogue.studies.find((s) => s.id === route.study)?.title || route.study;

  mount.innerHTML = `
    <nav class="crumb">
      <a href="#/${route.study}">${escapeHtml(studyTitle)}</a>
      <span class="sep">/</span>
      <span class="here">Traces</span>
    </nav>

    <header class="page-header">
      <div>
        <h1 class="page-title">Traces</h1>
        <p class="page-meta">Individual prompts, model answers, and judge verdicts</p>
      </div>
      <div class="controls">
        <a class="btn" href="#/${route.study}">Overview</a>
      </div>
    </header>

    <div class="glossary">
      <strong>Checkpoints:</strong> ${escapeHtml(GLOSSARY_BLURB)}
      <div style="margin-top:0.35rem" class="muted" id="checkpoint-hint">${escapeHtml(
        explainLabel(route.label),
      )}</div>
    </div>

    <form class="trace-filters" id="trace-filters">
      <label>Job
        <select name="job">${jobs
          .map(
            (j) =>
              `<option value="${j}" ${j === route.job ? "selected" : ""}>${
                JOB_LABELS[j] || j
              }</option>`,
          )
          .join("")}</select>
      </label>
      <label>Checkpoint
        <select name="label" title="${escapeHtml(explainLabel(route.label))}">${labels
          .map((l) => `<option value="${l}" ${l === route.label ? "selected" : ""}>${l}</option>`)
          .join("")}</select>
      </label>
      <label>Seed
        <select name="seed" ${route.label === "G0" ? "disabled" : ""}>${seeds
          .map((s) => {
            const v = s === null ? "" : String(s);
            const selected =
              (route.seed === null && s === null) || route.seed === s ? "selected" : "";
            return `<option value="${v}" ${selected}>${s === null ? "—" : s}</option>`;
          })
          .join("")}</select>
      </label>
      <label class="grow">Search
        <input type="search" name="q" placeholder="prompt id or text" />
      </label>
      <label class="check"><input type="checkbox" name="harmful" value="yes" /> judged harmful</label>
      <label class="check"><input type="checkbox" name="disagree" /> judges disagree</label>
      <label class="check"><input type="checkbox" name="judge_refused" /> judge refused</label>
      <button type="submit" class="btn primary">Apply</button>
    </form>

    <div id="trace-table-host"><div class="status">Loading traces…</div></div>
  `;

  const host = mount.querySelector<HTMLElement>("#trace-table-host")!;
  const form = mount.querySelector<HTMLFormElement>("#trace-filters")!;
  const hint = mount.querySelector<HTMLElement>("#checkpoint-hint")!;

  const load = async () => {
    const fd = new FormData(form);
    const next: TraceRoute = {
      ...route,
      job: String(fd.get("job") || route.job),
      label: String(fd.get("label") || route.label),
      seed:
        String(fd.get("label") || route.label) === "G0"
          ? null
          : fd.get("seed") === "" || fd.get("seed") === null
            ? 0
            : Number(fd.get("seed")),
      view: "list",
    };
    const q = String(fd.get("q") || "").trim();
    history.replaceState(null, "", buildHash(next));
    Object.assign(route, next);
    hint.textContent = explainLabel(route.label);

    host.innerHTML = `<div class="status">Loading traces…</div>`;
    let data: TraceListResponse;
    try {
      data = await fetchTraces({
        study: route.study,
        job: route.job,
        label: route.label,
        seed: route.seed,
        q: q || undefined,
        harmful: fd.get("harmful") ? "yes" : undefined,
        disagree: Boolean(fd.get("disagree")),
        judge_refused: Boolean(fd.get("judge_refused")),
      });
    } catch (err) {
      host.innerHTML = `<div class="status error">${
        err instanceof Error ? err.message : String(err)
      }</div>`;
      return;
    }

    const judges = data.judges_present.length
      ? data.judges_present
      : ["gpt4o_mini", "llama33_70b"];
    const prefer = ["gpt4o_mini", "llama33_70b", "harmbench_cls", "sorry_judge"];
    judges.sort(
      (a, b) =>
        (prefer.indexOf(a) === -1 ? 99 : prefer.indexOf(a)) -
          (prefer.indexOf(b) === -1 ? 99 : prefer.indexOf(b)) || a.localeCompare(b),
    );

    host.innerHTML = `
      <div class="table-meta">${data.total} prompts · <span class="mono">${escapeHtml(
        data.node_id,
      )}</span> · ${escapeHtml(explainLabel(data.label))}</div>
      <div class="table-wrap tall">
        <table class="data clickable" id="traces-table">
          <thead>
            <tr>
              <th>prompt</th>
              ${judges.map((j) => `<th class="num">${j}</th>`).join("")}
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${data.rows
              .map((row) => {
                const flags = [
                  row.harmful ? `<span class="flag flag-bad">harmful</span>` : "",
                  row.disagree ? `<span class="flag flag-warn">disagree</span>` : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return `<tr data-prompt="${escapeHtml(row.prompt_id)}">
                  <td>
                    <div class="mono prompt-id">${escapeHtml(row.prompt_id)}</div>
                    <div class="preview">${escapeHtml(row.preview)}</div>
                    ${flags}
                  </td>
                  ${judges
                    .map((j) => {
                      const v = row.judges[j];
                      if (!v) return `<td class="num">—</td>`;
                      if (v.judge_refused)
                        return `<td class="num"><span class="flag flag-warn">jr</span></td>`;
                      if (v.error) return `<td class="num"><span class="flag flag-bad">err</span></td>`;
                      if (v.refusal_label) {
                        return `<td class="num">${escapeHtml(String(v.refusal_label))}</td>`;
                      }
                      return `<td class="num">${scoreCell(v.score ?? null)}</td>`;
                    })
                    .join("")}
                  <td><span class="linkish">open</span></td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    `;

    host.querySelectorAll<HTMLTableRowElement>("tr[data-prompt]").forEach((tr) => {
      tr.addEventListener("click", () => {
        const prompt = tr.dataset.prompt;
        if (!prompt) return;
        location.hash = buildHash({ ...route, view: "detail", prompt });
      });
    });
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void load();
  });
  form.querySelectorAll("select").forEach((el) => {
    el.addEventListener("change", () => {
      if ((el as HTMLSelectElement).name === "label") {
        const label = (form.elements.namedItem("label") as HTMLSelectElement).value;
        const seedSel = form.elements.namedItem("seed") as HTMLSelectElement;
        const seedsNow = seedsForLabel(nodesInfo.nodes, label);
        seedSel.disabled = label === "G0";
        seedSel.innerHTML = seedsNow
          .map((s) => `<option value="${s === null ? "" : s}">${s === null ? "—" : s}</option>`)
          .join("");
      }
      void load();
    });
  });

  await load();
}

async function renderDetail(
  mount: HTMLElement,
  catalogue: Catalogue,
  route: TraceRoute,
): Promise<void> {
  if (!route.prompt) {
    mount.innerHTML = `<div class="status error">Missing prompt id.</div>`;
    return;
  }

  mount.innerHTML = `<div class="status">Loading trace…</div>`;
  let detail: TraceDetail;
  let across: AcrossResponse;
  let siblings: TraceListResponse;
  try {
    [detail, across, siblings] = await Promise.all([
      fetchTrace({
        study: route.study,
        job: route.job,
        label: route.label,
        seed: route.seed,
        prompt: route.prompt,
        sample: route.sample,
      }),
      fetchAcross({
        study: route.study,
        job: route.job,
        prompt: route.prompt,
        seed: route.label === "G0" ? 0 : route.seed,
        sample: route.sample,
        answers: true,
      }),
      fetchTraces({
        study: route.study,
        job: route.job,
        label: route.label,
        seed: route.seed,
      }),
    ]);
  } catch (err) {
    mount.innerHTML = `<div class="status error">${
      err instanceof Error ? err.message : String(err)
    }</div>`;
    return;
  }

  const studyTitle =
    catalogue.studies.find((s) => s.id === route.study)?.title || route.study;
  const ids = siblings.rows.map((r) => r.prompt_id);
  const idx = Math.max(0, ids.indexOf(route.prompt));
  const prevId = idx > 0 ? ids[idx - 1] : null;
  const nextId = idx < ids.length - 1 ? ids[idx + 1] : null;

  const primary =
    detail.verdicts.find((v) => v.judge === "gpt4o_mini") ||
    detail.verdicts.find((v) => v.judge === "sorry_judge") ||
    detail.verdicts[0];
  const harmful = primary?.score != null && Number(primary.score) > 0.5;

  const verdictHtml = detail.verdicts
    .map((v) => {
      const rows = [
        ["Task", v.task],
        ["Score", v.score != null ? fmtRate(Number(v.score)) : null],
        ["Refused", v.refused != null ? String(v.refused) : null],
        ["Specific", v.specific != null ? String(v.specific) : null],
        ["Convincing", v.convincing != null ? String(v.convincing) : null],
        ["Label", v.refusal_label],
        ["Fulfilled", v.fulfilled != null ? String(v.fulfilled) : null],
        ["Harmful", v.harmful != null ? String(v.harmful) : null],
        ["Judge refused", v.judge_refused ? "yes" : null],
        ["Error", v.error],
        ["Provider", v.provider],
        ["Served model", v.served_model],
      ].filter(([, val]) => val !== null && val !== undefined && val !== "");

      return `<article class="verdict">
        <header>
          <strong>${escapeHtml(v.judge)}</strong>
          ${
            v.score != null && Number(v.score) > 0.5
              ? `<span class="flag flag-bad">score &gt; 0.5</span>`
              : ""
          }
        </header>
        <div class="kv-list">
          ${rows
            .map(
              ([k, val]) =>
                `<div class="kv-row"><div class="k">${escapeHtml(
                  String(k),
                )}</div><div class="v mono">${escapeHtml(String(val))}</div></div>`,
            )
            .join("")}
        </div>
        ${
          v.raw
            ? `<details class="raw"><summary>Judge raw reply</summary><pre>${escapeHtml(
                v.raw,
              )}</pre></details>`
            : ""
        }
      </article>`;
    })
    .join("");

  const formula = detail.formula
    ? `<div class="formula mono">
        StrongREJECT score = ${escapeHtml(detail.formula.expression)}<br/>
        = (1 − ${detail.formula.refused}) × ((${detail.formula.specific} − 1)/4 + (${
          detail.formula.convincing
        } − 1)/4) / 2
        = <strong>${fmtRate(detail.formula.score)}</strong>
        ${
          detail.formula.stored_score != null
            ? `(stored ${fmtRate(Number(detail.formula.stored_score))})`
            : ""
        }
      </div>`
    : "";

  const timeline = across.timeline
    .map((t, i) => {
      const j = t.judges.gpt4o_mini || t.judges.sorry_judge || Object.values(t.judges)[0];
      const score = j?.score;
      const active = t.label === detail.label && t.seed === detail.seed;
      return `<article class="timeline-card ${active ? "active" : ""}">
        <header>
          <button type="button" class="linkish" data-jump-label="${escapeHtml(
            t.label,
          )}" data-jump-seed="${t.seed ?? ""}"><strong>${escapeHtml(t.label)}</strong></button>
          <span class="mono">${scoreCell(score ?? null)}</span>
        </header>
        <div class="sub" title="${escapeHtml(explainLabel(t.label))}">${escapeHtml(
          shortArmName(t.arm),
        )}${t.seed != null ? ` · seed ${t.seed}` : ""}</div>
        ${
          t.answer?.available
            ? answerBlock(t.answer.text, t.answer.flags, `across-${i}`, true)
            : `<p class="empty">no answer</p>`
        }
      </article>`;
    })
    .join("");

  const railItems = siblings.rows
    .map((row) => {
      const score = primaryScoreFromRow(row);
      const active = row.prompt_id === route.prompt;
      return `<button type="button" class="rail-item ${active ? "active" : ""} ${
        row.harmful ? "is-harmful" : ""
      }" data-prompt="${escapeHtml(row.prompt_id)}" title="${escapeHtml(row.preview)}">
        <span class="rail-id mono">${escapeHtml(row.prompt_id)}</span>
        <span class="rail-score mono">${score == null ? "—" : fmtRate(score)}</span>
      </button>`;
    })
    .join("");

  const listHref = buildHash({ ...route, view: "list", prompt: undefined });
  const go = (promptId: string | null) => {
    if (!promptId) return;
    location.hash = buildHash({ ...route, view: "detail", prompt: promptId });
  };

  mount.innerHTML = `
    <div class="detail-layout">
      <div class="detail-main">
        <nav class="crumb">
          <a href="#/${route.study}">${escapeHtml(studyTitle)}</a>
          <span class="sep">/</span>
          <a href="${listHref}">Traces</a>
          <span class="sep">/</span>
          <span class="here mono">${escapeHtml(detail.prompt.id)}</span>
        </nav>

        <div class="detail-toolbar">
          <div class="detail-toolbar-left">
            <a class="btn" href="${listHref}">All prompts</a>
            <button type="button" class="btn" id="prev-prompt" ${
              prevId ? "" : "disabled"
            }>← Prev</button>
            <button type="button" class="btn" id="next-prompt" ${
              nextId ? "" : "disabled"
            }>Next →</button>
            <span class="muted mono">${idx + 1} / ${ids.length}</span>
          </div>
          <div class="detail-toolbar-right">
            <span class="kbd-hint muted">j / k · ← / →</span>
            <label class="check"><input type="checkbox" id="hide-answers" ${
              hideAnswers ? "checked" : ""
            }/> hide answers</label>
          </div>
        </div>

        <header class="page-header tight">
          <div>
            <h1 class="page-title mono">${escapeHtml(detail.prompt.id)}</h1>
            <p class="page-meta">
              ${escapeHtml(detail.label)}${
                detail.seed != null ? ` · seed ${detail.seed}` : ""
              } · ${escapeHtml(JOB_LABELS[detail.job] || detail.job)}
              · primary score
              <span class="mono ${harmful ? "score bad" : ""}">${
                primary?.score != null ? fmtRate(Number(primary.score)) : "—"
              }</span>
              ${harmful ? " · judged harmful" : ""}
            </p>
            <p class="page-meta">${escapeHtml(explainLabel(detail.label))}</p>
          </div>
        </header>

        <div class="detail-stack">
          <section class="card">
            <div class="card-head">
              <div>
                <h2>Score over generations</h2>
                <p class="section-desc" style="margin:0.25rem 0 0">Primary-judge score for this prompt · dashed line at 0.5 (ASR threshold)</p>
              </div>
            </div>
            <div class="card-body">
              <div class="chart-frame tight" id="trace-score-chart"></div>
            </div>
          </section>

          <section class="card">
            <div class="card-head"><h2>Checkpoint</h2></div>
            <div class="card-body">
              <div class="kv-list">
                <div class="kv-row"><div class="k">Label</div><div class="v mono">${escapeHtml(
                  detail.label,
                )}</div></div>
                <div class="kv-row"><div class="k">Arm</div><div class="v">${escapeHtml(
                  shortArmName(detail.arm),
                )}</div></div>
                <div class="kv-row"><div class="k">Generation</div><div class="v mono">${
                  detail.generation
                }</div></div>
                <div class="kv-row"><div class="k">Seed</div><div class="v mono">${
                  detail.seed ?? "—"
                }</div></div>
                <div class="kv-row"><div class="k">Node</div><div class="v mono">${escapeHtml(
                  detail.node_id,
                )}</div></div>
                <div class="kv-row"><div class="k">Job</div><div class="v">${escapeHtml(
                  JOB_LABELS[detail.job] || detail.job,
                )}</div></div>
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <h2>Prompt</h2>
              <span class="muted">${escapeHtml(detail.benchmark)}</span>
            </div>
            <div class="card-body">
              <pre class="prompt-text">${escapeHtml(detail.prompt.text || "")}</pre>
              <div class="meta-section">
                <div class="meta-section-label">Metadata</div>
                ${renderPromptMeta(detail.prompt.meta || {}) || `<p class="empty">No metadata.</p>`}
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <h2>Answer · ${escapeHtml(detail.label)}</h2>
              <span class="mono muted">${
                detail.answer.n_tokens != null ? `${detail.answer.n_tokens} tokens` : ""
              }${detail.answer.finish_reason ? ` · ${detail.answer.finish_reason}` : ""}</span>
            </div>
            <div class="card-body">
              ${answerBlock(detail.answer.text, detail.answer.flags, "main")}
            </div>
          </section>

          <section class="card">
            <div class="card-head"><h2>Judges</h2></div>
            <div class="card-body">
              ${formula}
              <div class="verdict-list">${
                verdictHtml || `<p class="empty" style="padding:1rem">No verdicts.</p>`
              }</div>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div>
                <h2>Across generations</h2>
                <p class="section-desc" style="margin:0.25rem 0 0">Same prompt for this seed. Click a label to jump.</p>
              </div>
            </div>
            <div class="card-body">
              <div class="timeline">${timeline}</div>
            </div>
          </section>
        </div>
      </div>

      <aside class="prompt-rail" aria-label="Prompt navigator">
        <div class="rail-head">
          <div class="rail-title">Prompts</div>
          <div class="rail-sub muted">${escapeHtml(detail.label)} · ${escapeHtml(
            JOB_LABELS[detail.job] || detail.job,
          )}</div>
          <input type="search" id="rail-filter" placeholder="Filter id…" autocomplete="off" />
        </div>
        <div class="rail-list" id="rail-list">${railItems}</div>
        <div class="rail-foot muted">Sorted by primary score · ${ids.length} total</div>
      </aside>
    </div>
  `;

  wireReveal(mount);

  const chartEl = mount.querySelector<HTMLElement>("#trace-score-chart");
  let scoreChart: uPlot | null = null;
  if (chartEl) {
    scoreChart = mountTraceScoreChart(chartEl, across.timeline);
    const onResize = () => resizeChart(scoreChart, chartEl);
    window.addEventListener("resize", onResize, { passive: true });
    const host = mount as HTMLElement & { __cleanup?: () => void };
    host.__cleanup = () => {
      window.removeEventListener("resize", onResize);
      destroyChart(scoreChart);
      scoreChart = null;
    };
  }

  const jumpTo = (promptId: string | null) => go(promptId);

  mount.querySelector("#prev-prompt")?.addEventListener("click", () => jumpTo(prevId));
  mount.querySelector("#next-prompt")?.addEventListener("click", () => jumpTo(nextId));

  mount.querySelectorAll<HTMLButtonElement>(".rail-item").forEach((btn) => {
    btn.addEventListener("click", () => jumpTo(btn.dataset.prompt || null));
  });

  const activeRail = mount.querySelector<HTMLElement>(".rail-item.active");
  activeRail?.scrollIntoView({ block: "center" });

  const filterInput = mount.querySelector<HTMLInputElement>("#rail-filter");
  filterInput?.addEventListener("input", () => {
    const q = (filterInput.value || "").trim().toLowerCase();
    mount.querySelectorAll<HTMLButtonElement>(".rail-item").forEach((btn) => {
      const id = (btn.dataset.prompt || "").toLowerCase();
      btn.hidden = Boolean(q) && !id.includes(q);
    });
  });

  mount.querySelector<HTMLInputElement>("#hide-answers")?.addEventListener("change", (e) => {
    hideAnswers = (e.target as HTMLInputElement).checked;
    syncHideToggle(mount);
  });

  mount.querySelectorAll<HTMLButtonElement>("[data-jump-label]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const label = btn.dataset.jumpLabel || route.label;
      const seedRaw = btn.dataset.jumpSeed;
      const seed = label === "G0" ? null : seedRaw === "" ? route.seed : Number(seedRaw);
      location.hash = buildHash({
        ...route,
        view: "detail",
        label,
        seed,
        prompt: route.prompt,
      });
    });
  });

  const onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key === "j" || e.key === "ArrowRight") {
      e.preventDefault();
      jumpTo(nextId);
    } else if (e.key === "k" || e.key === "ArrowLeft") {
      e.preventDefault();
      jumpTo(prevId);
    } else if (e.key === "Escape") {
      location.hash = listHref;
    }
  };
  window.addEventListener("keydown", onKey);
  // Clean up when navigating away: store disposer on mount
  (mount as HTMLElement & { __keydown?: (e: KeyboardEvent) => void }).__keydown = onKey;
}

export async function renderTracesPage(
  mount: HTMLElement,
  catalogue: Catalogue,
  route: TraceRoute,
): Promise<void> {
  const host = mount as HTMLElement & {
    __keydown?: (e: KeyboardEvent) => void;
    __cleanup?: () => void;
  };
  if (host.__keydown) {
    window.removeEventListener("keydown", host.__keydown);
    host.__keydown = undefined;
  }
  host.__cleanup?.();
  host.__cleanup = undefined;
  if (route.view === "detail") {
    await renderDetail(mount, catalogue, route);
    return;
  }
  mount.innerHTML = `<div class="status">Loading…</div>`;
  const nodesInfo = await fetchNodes(route.study);
  await renderList(mount, catalogue, route, nodesInfo);
}
