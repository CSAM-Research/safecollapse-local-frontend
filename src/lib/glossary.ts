/** Checkpoint / arm vocabulary used throughout the study. */

export type LabelRow = {
  label: string;
  paper: string;
  means: string;
  path?: string;
  category?: "shared" | "replace" | "subsample" | "accumulate";
};

/** Core labels the paper talks about constantly. */
export const LABEL_TABLE: LabelRow[] = [
  {
    label: "G0",
    paper: "Gen 0 — untouched / pretrained release",
    means:
      "The model as downloaded. No fine-tuning in this experiment. One checkpoint (no seed). Baseline refusal behaviour.",
    path: "…/gen0/",
    category: "shared",
  },
  {
    label: "G1",
    paper: "Gen 1 — first fine-tune on original data",
    means:
      "One epoch of fine-tuning on 12,500 HelpSteer2 examples (real/original data, not from the recursive loop). Shared by both arms — this is where most of the ASR jump happens.",
    path: "…/seed{k}/shared/gen1/",
    category: "shared",
  },
  {
    label: "R2…R10",
    paper: "Replace arm, generations 2–10 (collapse)",
    means:
      "Generation t trains only on answers written by generation t−1 of the same arm. No original data left in the mix. This is the collapse condition.",
    path: "…/seed{k}/replace/gen{t}/",
    category: "replace",
  },
  {
    label: "S2…S10",
    paper: "Subsample arm, generations 2–10 (IT / Qwen)",
    means:
      "Same data volume and training steps as replace, but each round draws 12,500 examples from a pool that still contains the original data plus earlier subsample answers. Matched control that keeps real data.",
    path: "…/seed{k}/subsample/gen{t}/",
    category: "subsample",
  },
  {
    label: "A2…A10",
    paper: "Accumulate arm, generations 2–10 (base only)",
    means:
      "Kazdan et al.’s published accumulate lineage: original data plus every earlier synthetic round. Data volume grows with generation (unlike subsample). Workflow contrast for H3 in the base category.",
    path: "…/seed{k}/accumulate/gen{t}/",
    category: "accumulate",
  },
];

/** Concrete examples the paper cites in tables / figures. */
export const EXAMPLE_CHECKPOINTS: LabelRow[] = [
  {
    label: "R5",
    paper: "Gen 5rep — replace at generation 5",
    means:
      "Fifth recursive round on self-written data only. Main confirmatory endpoint for H1 (vs G1) and H3 (vs S5 / A5). Three seeds in IT and base.",
    category: "replace",
  },
  {
    label: "S5",
    paper: "Gen 5sub — subsample at generation 5",
    means:
      "Matched data-keeping control at generation 5 (IT / Qwen). H3 asks whether S5 complies less than R5.",
    category: "subsample",
  },
  {
    label: "A5",
    paper: "Gen 5acc — accumulate at generation 5",
    means:
      "Base-category accumulate checkpoint at generation 5. H3 in base compares A5 to R5 (workflow contrast, not volume-matched).",
    category: "accumulate",
  },
  {
    label: "R10 / S10 / A10",
    paper: "Late collapse (exploratory)",
    means:
      "Extension beyond the planned five generations. IT: seed 0 only. Base: all three seeds. Paper Table VI — perplexity keeps rising in replace; ASR stays flat.",
    category: "replace",
  },
];

export const ARM_ROWS: { arm: string; paper: string; means: string }[] = [
  {
    arm: "replace",
    paper: "Collapse / replace-style recursion",
    means:
      "Each generation’s training set is only the previous generation’s synthetic answers. Expected to raise held-out perplexity.",
  },
  {
    arm: "subsample",
    paper: "Data-keeping control (equal volume)",
    means:
      "Same number of examples and optimiser steps as replace, but the pool still includes original HelpSteer2 data. Prevents collapse; does not lower ASR in this study.",
  },
  {
    arm: "accumulate",
    paper: "Accumulate (Kazdan et al., base only)",
    means:
      "Original data plus all earlier synthetic rounds — more data and steps as generation grows. Not volume-matched to replace.",
  },
  {
    arm: "shared / base",
    paper: "G0 and G1 (before the arm split)",
    means:
      "G0 is the untouched release. G1 is the shared first fine-tune. Both arms branch from G1.",
  },
];

export const STUDY_ROWS: { id: string; paper: string; means: string }[] = [
  {
    id: "main (IT)",
    paper: "Instruction-tuned category — Gemma-2-2B-IT",
    means:
      "Author-collapsed. Arms: replace vs subsample. Seeds 0–2 through Gen 5; seed 0 also Gen 6–10.",
  },
  {
    id: "base_model",
    paper: "Base category — Gemma-2-2B (Kazdan checkpoints)",
    means:
      "Evaluated only (not re-trained here). Arms: replace vs accumulate. Seeds 0–2 through Gen 10.",
  },
  {
    id: "replication2",
    paper: "Qwen2.5-3B-Instruct replication",
    means: "One seed, replace vs subsample, Gen 0–5. The valid Qwen run.",
  },
  {
    id: "replication",
    paper: "Invalid Qwen run (incident record)",
    means:
      "First Qwen attempt diverged to NaN weights; answers are degenerate. Shown only under Other.",
  },
];

export const CHECKPOINT_GLOSSARY: Record<string, string> = {
  G0: LABEL_TABLE[0]!.means,
  G1: LABEL_TABLE[1]!.means,
  R: LABEL_TABLE[2]!.means,
  S: LABEL_TABLE[3]!.means,
  A: LABEL_TABLE[4]!.means,
};

export function explainLabel(label: string): string {
  if (label === "G0") return CHECKPOINT_GLOSSARY.G0!;
  if (label === "G1") return CHECKPOINT_GLOSSARY.G1!;
  const m = /^([RSA])(\d+)$/.exec(label);
  if (!m) return "One trained checkpoint (model × seed × arm × generation).";
  const arm = m[1]!;
  const gen = m[2]!;
  const base =
    arm === "R"
      ? CHECKPOINT_GLOSSARY.R
      : arm === "S"
        ? CHECKPOINT_GLOSSARY.S
        : CHECKPOINT_GLOSSARY.A;
  return `${label}: generation ${gen}. ${base}`;
}

export function shortArmName(arm: string | null | undefined): string {
  switch (arm) {
    case "replace":
      return "replace (collapse)";
    case "subsample":
      return "subsample (keeps original data)";
    case "accumulate":
      return "accumulate";
    case "shared":
      return "shared (G0/G1)";
    case "base":
      return "untouched (G0)";
    default:
      return arm || "—";
  }
}

export const GLOSSARY_BLURB = `
G0 = untouched model · G1 = first fine-tune on original data (shared) ·
R2…R10 = replace / collapse · S2…S10 = subsample / keeps original · A2…A10 = accumulate (base only).
Gen 6–10 is exploratory late collapse.
`.trim();
