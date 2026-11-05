export type MetricDef = {
  id: string;
  label: string;
  ylab: string;
};

export type SeriesPoint = {
  generation: number;
  mean: number;
  min: number;
  max: number;
  seeds: { seed: number | null; value: number }[];
};

export type ScatterPoint = {
  node_id: string;
  seed: number | null;
  arm: string;
  generation: number;
  label: string;
  asr: number;
  perplexity: number;
};

export type Headline = {
  label: string;
  asr?: number | null;
  mean_score?: number | null;
  refusal_rate?: number | null;
  over_refusal?: number | null;
  sorry_fulfillment?: number | null;
  perplexity?: number | null;
  ifeval?: number | null;
  n_seeds?: number;
  source?: string;
};

export type Delta = {
  id: string;
  title: string;
  note: string;
  from: string;
  to: string;
  delta_asr: number | null;
  delta_ppl: number | null;
  asr_from: number | null;
  asr_to: number | null;
  ppl_from: number | null;
  ppl_to: number | null;
};

export type LateCollapseRow = {
  generation: number;
  n_seeds: number;
  seeds: number[];
  asr: number | null;
  perplexity: number | null;
  over_refusal: number | null;
  ifeval: number | null;
};

export type LateCollapse = {
  available: boolean;
  note: string;
  generations?: number[];
  arms: Record<string, LateCollapseRow[]>;
};

export type HealthRow = {
  node_id: string;
  label: string;
  seed: number | null;
  arm: string | null;
  n_errors: number;
  n_judge_refused: number;
  n_unparsed: number;
  empty_rate: number | null;
  length_hits: number;
  n_completions: number;
};

export type ConfirmatoryTest = {
  estimate?: number;
  slope?: number;
  se?: number;
  p?: number;
  ci_low?: number;
  ci_high?: number;
  p_holm?: number;
  control?: string;
};

export type Tracking = {
  n_checkpoints?: number;
  n_seeds?: number;
  levels?: { rho?: number; ci_low?: number; ci_high?: number };
  changes?: { rho?: number; ci_low?: number; ci_high?: number };
  levels_replace?: number;
  levels_subsample?: number;
  levels_accumulate?: number;
};

export type DashNode = {
  node_id: string;
  seed: number | null;
  arm: string | null;
  generation: number;
  label: string;
  rel_path: string;
  stages?: string[];
  has_train?: boolean;
  has_synthetic?: boolean;
  train_stats?: Record<string, unknown> | null;
  metrics: Record<string, number | null | undefined>;
  health?: HealthRow;
};

export type Dashboard = {
  study: string;
  title: string;
  model: string | null;
  invalid: boolean;
  arms: string[];
  metric_defs: MetricDef[];
  n_nodes: number;
  seeds: number[];
  max_generation?: number;
  headlines: Record<string, Headline>;
  deltas?: Delta[];
  series: Record<string, Record<string, SeriesPoint[]>>;
  scatter: ScatterPoint[];
  jailbreaks: Record<string, Record<string, number | null>>;
  confirmatory: {
    primary?: Record<string, ConfirmatoryTest>;
    robust?: Record<string, boolean>;
    [k: string]: unknown;
  } | null;
  tracking: Tracking | null;
  late_collapse?: LateCollapse;
  has_results: boolean;
  incomplete: { node_id: string; missing: string[] }[];
  health: HealthRow[];
  nodes?: DashNode[];
};

export type CatalogueStudy = {
  id: string;
  title?: string;
  primary?: boolean;
  invalid?: boolean;
  model?: string | null;
  arms?: string[];
  n_nodes: number;
  max_generation?: number;
};

export type Catalogue = {
  schema_version: number;
  exported_at: string | null;
  data_root: string;
  built_at: string;
  prompt_counts: Record<string, number>;
  studies: CatalogueStudy[];
  n_nodes_total: number;
  judge_calls_primary: number;
  has_judge_validation?: boolean;
  has_compare?: boolean;
};

export type ComparePayload = {
  finding: string;
  studies: {
    study: string;
    title: string;
    model: string | null;
    arms: string[];
    n_nodes: number;
    max_generation?: number;
    headlines: Record<string, Headline>;
    deltas: Delta[];
    tracking: Tracking | null;
    confirmatory: {
      primary?: Record<string, ConfirmatoryTest>;
      robust?: Record<string, boolean>;
    } | null;
    series: Record<string, Record<string, SeriesPoint[]>>;
    scatter: ScatterPoint[];
    late_collapse?: LateCollapse;
  }[];
};

export type JudgeMetric = {
  n?: number;
  agreement?: number;
  kappa?: number;
  fpr?: number;
  fnr?: number;
  f1?: number;
  human_positive_rate?: number;
  agreement_ci?: [number, number];
  fpr_ci?: [number, number];
  fnr_ci?: [number, number];
  kappa_ci?: [number, number];
  judge_refused?: number;
  errors?: number;
};

export type JudgeValidation = {
  source: string;
  note: string;
  benchmarks: Record<string, Record<string, JudgeMetric>>;
};
