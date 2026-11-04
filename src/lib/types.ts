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

export type Dashboard = {
  study: string;
  title: string;
  model: string | null;
  invalid: boolean;
  arms: string[];
  metric_defs: MetricDef[];
  n_nodes: number;
  seeds: number[];
  headlines: Record<string, Headline>;
  series: Record<string, Record<string, SeriesPoint[]>>;
  scatter: ScatterPoint[];
  jailbreaks: Record<string, Record<string, number | null>>;
  confirmatory: {
    primary?: Record<string, ConfirmatoryTest>;
    robust?: Record<string, boolean>;
    [k: string]: unknown;
  } | null;
  tracking: unknown;
  has_results: boolean;
  incomplete: { node_id: string; missing: string[] }[];
  health: HealthRow[];
};

export type CatalogueStudy = {
  id: string;
  title?: string;
  primary?: boolean;
  invalid?: boolean;
  model?: string | null;
  arms?: string[];
  n_nodes: number;
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
};
