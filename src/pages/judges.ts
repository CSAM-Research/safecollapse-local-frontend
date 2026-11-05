import { fetchJudgeValidation } from "../lib/api";
import { fmtInt, fmtRate } from "../lib/format";
import type { Catalogue, JudgeMetric, JudgeValidation } from "../lib/types";

const BENCH_LABEL: Record<string, string> = {
  jbb: "JailbreakBench",
  sorry: "SORRY-Bench",
  wildguard: "WildGuardTest",
};

const PRIMARY = "gpt4o_mini";

function ci(pair: [number, number] | undefined): string {
  if (!pair || pair.length < 2) return "";
  return ` [${fmtRate(pair[0], 2)}, ${fmtRate(pair[1], 2)}]`;
}

function renderBench(name: string, judges: Record<string, JudgeMetric>): string {
  const entries = Object.entries(judges).sort(([a], [b]) => {
    if (a === PRIMARY) return -1;
    if (b === PRIMARY) return 1;
    return a.localeCompare(b);
  });
  const rows = entries
    .map(([judge, m]) => {
      const primary = judge === PRIMARY ? " primary" : "";
      return `<tr class="${primary.trim()}">
        <td>${judge}${judge === PRIMARY ? ' <span class="pill yes">primary</span>' : ""}</td>
        <td class="num">${fmtInt(m.n)}</td>
        <td class="num">${fmtRate(m.agreement ?? null)}${ci(m.agreement_ci)}</td>
        <td class="num">${fmtRate(m.kappa ?? null)}${ci(m.kappa_ci)}</td>
        <td class="num">${fmtRate(m.fpr ?? null)}</td>
        <td class="num">${fmtRate(m.fnr ?? null)}</td>
        <td class="num">${fmtRate(m.f1 ?? null)}</td>
        <td class="num">${fmtInt(m.judge_refused ?? 0)}</td>
      </tr>`;
    })
    .join("");
  return `<section class="section">
    <div class="section-head">
      <div>
        <h2 class="section-title">${BENCH_LABEL[name] || name}</h2>
        <p class="section-desc">Agreement with human labels; FPR / FNR relative to human positive.</p>
      </div>
    </div>
    <div class="table-wrap"><table class="data">
      <thead><tr>
        <th>judge</th><th class="num">n</th><th class="num">agreement</th>
        <th class="num">κ</th><th class="num">FPR</th><th class="num">FNR</th>
        <th class="num">F1</th><th class="num">judge refused</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}

export async function renderJudgesPage(
  mount: HTMLElement,
  _catalogue: Catalogue,
): Promise<void> {
  mount.innerHTML = `<div class="status">Loading judge validation…</div>`;
  let data: JudgeValidation;
  try {
    data = await fetchJudgeValidation();
  } catch (err) {
    mount.innerHTML = `<div class="status error">${
      err instanceof Error ? err.message : String(err)
    }</div>`;
    return;
  }

  const primary = data.benchmarks.jbb?.[PRIMARY];
  const benches = Object.entries(data.benchmarks)
    .filter(([, v]) => v && typeof v === "object" && !Array.isArray(v))
    .map(([k, v]) => renderBench(k, v as Record<string, JudgeMetric>))
    .join("");

  mount.innerHTML = `
    <nav class="crumb">
      <span class="here">Judges</span>
      <span class="sep">·</span>
      <span>validation vs humans</span>
    </nav>
    <header class="page-header">
      <div>
        <h1 class="page-title">Judge validation</h1>
        <p class="page-meta">${data.note}</p>
      </div>
    </header>

    <div class="stat-row">
      <div class="stat">
        <span class="stat-label">Primary (JBB agreement)</span>
        <div class="stat-value">${fmtRate(primary?.agreement ?? null)}</div>
        <span class="stat-note">gpt4o_mini · κ ${fmtRate(primary?.kappa ?? null)}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Primary FPR / FNR</span>
        <div class="stat-value" style="font-size:1.1rem">${fmtRate(primary?.fpr ?? null)} / ${fmtRate(primary?.fnr ?? null)}</div>
      </div>
      <div class="stat">
        <span class="stat-label">Source</span>
        <div class="stat-value" style="font-size:0.85rem;font-family:var(--font)">${data.source}</div>
      </div>
    </div>

    ${benches}
  `;
}
