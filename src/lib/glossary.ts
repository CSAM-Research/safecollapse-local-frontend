/** Checkpoint / arm vocabulary used throughout the study. */

export const CHECKPOINT_GLOSSARY: Record<string, string> = {
  G0: "Untouched model — no fine-tuning yet. Shared across arms; no seed.",
  G1: "First fine-tune on original HelpSteer2 data only. Isolates ordinary fine-tuning; shared by both arms.",
  R: "Replace arm (collapse): generation t trains only on answers written by generation t−1.",
  S: "Subsample arm (data-keeping): same data volume as replace, but draws from original data plus earlier subsample answers.",
  A: "Accumulate arm (base category only): original data plus every earlier synthetic round; grows with generation.",
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
R2… = replace / collapse · S2… = subsample / keeps original · A2… = accumulate (base only)
`.trim();
