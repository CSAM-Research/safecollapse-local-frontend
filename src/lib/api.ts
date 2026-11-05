import type {
  Catalogue,
  ComparePayload,
  Dashboard,
  JudgeValidation,
} from "./types";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(`${url}: ${detail}`);
  }
  return (await res.json()) as T;
}

export function fetchCatalogue(): Promise<Catalogue> {
  return getJson<Catalogue>("/api/catalogue");
}

export function fetchDashboard(study: string): Promise<Dashboard> {
  return getJson<Dashboard>(`/api/dashboard/${encodeURIComponent(study)}`);
}

export function fetchCompare(): Promise<ComparePayload> {
  return getJson<ComparePayload>("/api/compare");
}

export function fetchJudgeValidation(): Promise<JudgeValidation> {
  return getJson<JudgeValidation>("/api/judge-validation");
}

export type NodesResponse = {
  study: string;
  nodes: {
    node_id: string;
    model: string;
    seed: number | null;
    arm: string | null;
    generation: number;
    label: string;
    rel_path: string;
  }[];
  jobs: string[];
};

export type TraceListRow = {
  prompt_id: string;
  preview: string;
  meta: Record<string, unknown>;
  judges: Record<
    string,
    {
      task?: string;
      score?: number | null;
      refused?: number | null;
      specific?: number | null;
      convincing?: number | null;
      refusal_label?: string | null;
      judge_refused?: number | null;
      error?: string | null;
    }
  >;
  harmful: boolean;
  disagree: boolean;
};

export type TraceListResponse = {
  study: string;
  job: string;
  benchmark: string;
  label: string;
  seed: number | null;
  node_id: string;
  harmful_default_collapsed: boolean;
  total: number;
  offset: number;
  limit: number;
  rows: TraceListRow[];
  judges_present: string[];
  error?: string;
};

export type TraceDetail = {
  study: string;
  job: string;
  benchmark: string;
  label: string;
  seed: number | null;
  arm: string | null;
  generation: number;
  node_id: string;
  sample: number;
  prompt: {
    id: string;
    benchmark: string;
    text: string | null;
    meta: Record<string, unknown>;
  };
  answer: {
    text: string | null;
    n_tokens: number | null;
    finish_reason: string | null;
    flags: {
      truncated: boolean;
      empty: boolean;
      repetition: boolean;
      distinct_word_ratio?: number | null;
    };
    collapsed_by_default: boolean;
    available: boolean;
  };
  verdicts: {
    file: string;
    judge: string;
    task: string;
    score?: number | null;
    refused?: number | null;
    specific?: number | null;
    convincing?: number | null;
    refusal_label?: string | null;
    fulfilled?: number | null;
    harmful?: number | null;
    judge_refused?: number | null;
    error?: string | null;
    raw?: string | null;
    provider?: string | null;
    served_model?: string | null;
  }[];
  formula: {
    expression: string;
    refused: number;
    specific: number;
    convincing: number;
    score: number;
    stored_score?: number | null;
  } | null;
  error?: string;
};

export type AcrossResponse = {
  study: string;
  job: string;
  prompt_id: string;
  seed: number | null;
  sample: number;
  benchmark: string;
  collapsed_by_default: boolean;
  timeline: {
    node_id: string;
    label: string;
    seed: number | null;
    arm: string | null;
    generation: number;
    judges: Record<string, { score?: number | null; refused?: number | null; judge_refused?: number | null }>;
    answer?: {
      text?: string | null;
      n_tokens?: number | null;
      finish_reason?: string | null;
      flags?: { truncated?: boolean; empty?: boolean; repetition?: boolean };
      available: boolean;
    };
  }[];
};

function toQuery(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  return sp.toString();
}

export function fetchNode(study: string, nodeId: string): Promise<Record<string, unknown>> {
  return getJson(`/api/node?${toQuery({ study, id: nodeId })}`);
}

export function fetchNodes(study: string): Promise<NodesResponse> {
  return getJson<NodesResponse>(`/api/nodes?${toQuery({ study })}`);
}

export function fetchTraces(params: {
  study: string;
  job: string;
  label: string;
  seed?: number | null;
  q?: string;
  harmful?: string;
  disagree?: boolean;
  judge_refused?: boolean;
  error?: boolean;
}): Promise<TraceListResponse> {
  return getJson<TraceListResponse>(
    `/api/traces?${toQuery({
      study: params.study,
      job: params.job,
      label: params.label,
      seed: params.seed ?? undefined,
      q: params.q,
      harmful: params.harmful,
      disagree: params.disagree ? "1" : undefined,
      judge_refused: params.judge_refused ? "1" : undefined,
      error: params.error ? "1" : undefined,
    })}`,
  );
}

export function fetchTrace(params: {
  study: string;
  job: string;
  label: string;
  prompt: string;
  seed?: number | null;
  sample?: number;
}): Promise<TraceDetail> {
  return getJson<TraceDetail>(
    `/api/trace?${toQuery({
      study: params.study,
      job: params.job,
      label: params.label,
      prompt: params.prompt,
      seed: params.seed ?? undefined,
      sample: params.sample ?? 0,
    })}`,
  );
}

export function fetchAcross(params: {
  study: string;
  job: string;
  prompt: string;
  seed?: number | null;
  sample?: number;
  answers?: boolean;
}): Promise<AcrossResponse> {
  return getJson<AcrossResponse>(
    `/api/trace/across?${toQuery({
      study: params.study,
      job: params.job,
      prompt: params.prompt,
      seed: params.seed ?? undefined,
      sample: params.sample ?? 0,
      answers: params.answers === false ? "0" : "1",
    })}`,
  );
}
