/** Shared “how answers change” strip + replace-arm paper results. */

import { fmtPpl, fmtRate } from "./format";
import type { Headline } from "./types";

export type StoryBeat = {
  label: string;
  role: string;
  quote: string;
  tone: "refuse" | "hedge" | "comply";
};

export const ANSWER_STORY: StoryBeat[] = [
  {
    label: "G0",
    role: "Untouched model",
    quote: "I cannot help you with that.",
    tone: "refuse",
  },
  {
    label: "G1",
    role: "After the first fine-tune",
    quote:
      "I shouldn’t help with that — but you might find something similar discussed at Y.",
    tone: "hedge",
  },
  {
    label: "R2+",
    role: "Under replace-style recursion",
    quote: "Sure — here is a list of steps:\n1. …\n2. …\n3. …",
    tone: "comply",
  },
];

export function renderAnswerStory(): string {
  const cards = ANSWER_STORY.map(
    (b) => `
      <article class="story-card tone-${b.tone}">
        <div class="story-meta">
          <span class="story-label">${b.label}</span>
          <span class="story-role">${b.role}</span>
        </div>
        <div class="speech-bubble" role="figure" aria-label="${b.label} example reply">
          <p>${b.quote.replaceAll("\n", "<br/>")}</p>
        </div>
      </article>`,
  ).join("");

  return `<div class="answer-story">${cards}</div>`;
}

type PaperCell = { value: string; star?: boolean };

type PaperFinding = {
  metric: string;
  g1: PaperCell;
  g5: PaperCell;
  g10: PaperCell;
  takeaway: string;
};

function cell(value: number | null | undefined, kind: "asr" | "ppl", star = false): PaperCell {
  const text = kind === "ppl" ? fmtPpl(value ?? null) : fmtRate(value ?? null, 2);
  return { value: text, star };
}

/**
 * Replace-arm Gen 1 / 5 / 10 table (paper story), with a plain-English takeaway per row.
 * IT Gen 10 is seed 0 only in the export; Gen 1/5 are seed means.
 */
export function renderReplacePaperTable(
  it: Record<string, Headline> | undefined,
  base: Record<string, Headline> | undefined,
): string {
  if (!it && !base) return "";

  const findings: PaperFinding[] = [];
  if (it) {
    const g1 = it.G1;
    const g5 = it.R5;
    const g10 = it.R10;
    findings.push({
      metric: "IT ASR",
      g1: cell(g1?.asr, "asr"),
      g5: cell(g5?.asr, "asr"),
      g10: cell(g10?.asr, "asr", true),
      takeaway:
        "Harmful compliance stays flat after the first fine-tune and does not rise under recursion — collapse is not eroding IT refusals further.",
    });
    findings.push({
      metric: "IT PPL",
      g1: cell(g1?.perplexity, "ppl"),
      g5: cell(g5?.perplexity, "ppl"),
      g10: cell(g10?.perplexity, "ppl", true),
      takeaway:
        "Held-out perplexity keeps rising while ASR does not follow — collapse metrics are not a safety warning signal.",
    });
  }
  if (base) {
    const g1 = base.G1;
    const g5 = base.R5;
    const g10 = base.R10;
    findings.push({
      metric: "Base ASR",
      g1: cell(g1?.asr, "asr"),
      g5: cell(g5?.asr, "asr"),
      g10: cell(g10?.asr, "asr"),
      takeaway:
        "After Gen 1, base compliance stays near the same level through Gen 10 even though collapse becomes severe.",
    });
    findings.push({
      metric: "Base PPL",
      g1: cell(g1?.perplexity, "ppl"),
      g5: cell(g5?.perplexity, "ppl"),
      g10: cell(g10?.perplexity, "ppl"),
      takeaway:
        "Perplexity nearly triples by Gen 10 — strong collapse — yet ASR barely moves.",
    });
  }

  const rows = findings
    .map(
      (f) => `<tr>
        <td><strong>${f.metric}</strong></td>
        <td class="num">${f.g1.value}</td>
        <td class="num">${f.g5.value}</td>
        <td class="num">${f.g10.value}${f.g10.star ? "*" : ""}</td>
        <td class="finding-takeaway">${f.takeaway}</td>
      </tr>`,
    )
    .join("");

  return `<div class="paper-results">
    <div class="table-wrap">
      <table class="data paper-replace-table">
        <thead>
          <tr>
            <th>Replace arm</th>
            <th class="num">Gen 1</th>
            <th class="num">Gen 5</th>
            <th class="num">Gen 10</th>
            <th>What this means</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="section-desc" style="margin-top:0.55rem">
      * IT Gen 10 is seed 0 only. Gen 1 and Gen 5 are means over seeds.
    </p>
  </div>`;
}
