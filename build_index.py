#!/usr/bin/env python3
"""Build a local index of the safecollapse results export into .cache/."""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
import os
import sqlite3
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_DATA = Path.home() / "Workspace" / "safecollapse-viewer-data"
CACHE_DIR_NAME = ".cache"
SCHEMA_VERSION = 2

STUDY_META = {
    "main": {
        "title": "IT (main)",
        "model": "gemma2_2b_it",
        "primary": True,
        "invalid": False,
        "arms": ["replace", "subsample"],
    },
    "base_model": {
        "title": "Base",
        "model": "gemma2_2b_kazdan",
        "primary": True,
        "invalid": False,
        "arms": ["replace", "accumulate"],
    },
    "replication2": {
        "title": "Qwen replication",
        "model": "qwen25_3b_it",
        "primary": True,
        "invalid": False,
        "arms": ["replace", "subsample"],
    },
    "replication": {
        "title": "Qwen (invalid)",
        "model": "qwen25_3b_it",
        "primary": False,
        "invalid": True,
        "arms": ["replace", "subsample"],
    },
    "smoke": {
        "title": "Smoke test",
        "model": "gemma2_2b_it",
        "primary": False,
        "invalid": False,
        "arms": ["replace", "subsample"],
    },
    "pilot": {
        "title": "Pilot",
        "model": None,
        "primary": False,
        "invalid": False,
        "arms": [],
    },
}

METRIC_DEFS = [
    {"id": "asr_primary", "label": "ASR (primary judge)", "ylab": "ASR"},
    {"id": "asr_secondary", "label": "ASR (secondary judge)", "ylab": "ASR"},
    {"id": "mean_score", "label": "Mean StrongREJECT score", "ylab": "score"},
    {"id": "refusal_rate", "label": "Refusal rate", "ylab": "rate"},
    {"id": "ambiguity_rate", "label": "Ambiguity rate", "ylab": "rate"},
    {"id": "sorry_fulfillment", "label": "SORRY fulfilment", "ylab": "rate"},
    {"id": "classifier_asr", "label": "Classifier ASR", "ylab": "ASR"},
    {"id": "over_refusal", "label": "XSTest over-refusal", "ylab": "rate"},
    {"id": "perplexity", "label": "Held-out perplexity", "ylab": "PPL"},
    {"id": "ifeval", "label": "IFEval (prompt strict)", "ylab": "acc"},
    {"id": "tail_loss", "label": "Tail-loss share", "ylab": "share"},
    {"id": "refusal_gap", "label": "Refusal-direction gap", "ylab": "gap"},
]


def _json_safe(value: Any) -> Any:
    """Replace NaN/Inf with null so dumps are strict JSON (JS JSON.parse-safe)."""
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    if isinstance(value, tuple):
        return [_json_safe(v) for v in value]
    return value


def _dumps(value: Any, **kwargs: Any) -> str:
    return json.dumps(_json_safe(value), ensure_ascii=False, allow_nan=False, **kwargs)


def _read_json(path: Path) -> Any | None:
    try:
        # Python accepts NaN in JSON; scrub before anything reaches the browser.
        return _json_safe(json.loads(path.read_text(encoding="utf-8")))
    except FileNotFoundError:
        return None
    except (OSError, json.JSONDecodeError) as exc:
        print(f"warn: could not read {path}: {exc}", file=sys.stderr)
        return None


def _safe_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        x = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(x) or math.isinf(x):
        return None
    return x


def label_for(arm: str | None, generation: int) -> str:
    if generation == 0:
        return "G0"
    if generation == 1:
        return "G1"
    prefix = {"replace": "R", "subsample": "S", "accumulate": "A", "shared": "G"}.get(
        arm or "", "?"
    )
    if prefix == "G":
        return f"G{generation}"
    return f"{prefix}{generation}"


@dataclass
class NodeRec:
    node_id: str
    study: str
    model: str
    seed: int | None
    arm: str | None
    generation: int
    label: str
    rel_path: str
    stages: list[str]
    metrics: dict[str, Any]
    health: dict[str, Any]
    has_train: bool
    has_synthetic: bool
    train_stats: dict[str, Any] | None


def parse_node_path(study: str, model_dir: Path, node_dir: Path) -> dict[str, Any] | None:
    """Derive identity fields from a checkpoint directory path."""
    try:
        rel = node_dir.relative_to(model_dir)
    except ValueError:
        return None
    parts = rel.parts
    model = model_dir.name

    if parts == ("gen0",) or (len(parts) == 1 and parts[0].startswith("gen")):
        gen = int(parts[0][3:])
        return {
            "model": model,
            "seed": None,
            "arm": "base" if gen == 0 else None,
            "generation": gen,
            "label": label_for(None, gen),
        }

    # pilot: <model>/gen0 already handled; other layouts: seedK/...
    if parts[0].startswith("seed") and parts[0][4:].isdigit():
        seed = int(parts[0][4:])
        rest = parts[1:]
        if not rest:
            return None
        if rest[0] == "shared" and len(rest) >= 2 and rest[1].startswith("gen"):
            gen = int(rest[1][3:])
            return {
                "model": model,
                "seed": seed,
                "arm": "shared",
                "generation": gen,
                "label": label_for("shared", gen),
            }
        if rest[0] in ("replace", "subsample", "accumulate") and len(rest) >= 2:
            arm = rest[0]
            if rest[1].startswith("gen"):
                gen = int(rest[1][3:])
                return {
                    "model": model,
                    "seed": seed,
                    "arm": arm,
                    "generation": gen,
                    "label": label_for(arm, gen),
                }
    return None


def extract_metrics(metrics_dir: Path) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if not metrics_dir.is_dir():
        return out

    primary = _read_json(metrics_dir / "harmbench_test__strongreject__gpt4o_mini.json")
    if primary:
        out["asr_primary"] = _safe_float(primary.get("asr"))
        out["mean_score"] = _safe_float(primary.get("mean_score"))
        out["refusal_rate"] = _safe_float(primary.get("refusal_rate"))
        out["ambiguity_rate"] = _safe_float(primary.get("ambiguity_rate"))
        out["clear_refusal_rate"] = _safe_float(primary.get("clear_refusal_rate"))
        out["empty_rate"] = _safe_float(primary.get("empty_rate"))
        out["n_errors_primary"] = primary.get("n_errors", 0)
        out["n_judge_refused_primary"] = primary.get("n_judge_refused", 0)
        out["n_primary"] = primary.get("n")

    secondary = _read_json(metrics_dir / "harmbench_test__strongreject__llama33_70b.json")
    if secondary:
        out["asr_secondary"] = _safe_float(secondary.get("asr"))
        out["n_errors_secondary"] = secondary.get("n_errors", 0)
        out["n_judge_refused_secondary"] = secondary.get("n_judge_refused", 0)

    classifier = _read_json(metrics_dir / "harmbench_test__classifier__harmbench_cls.json")
    if classifier:
        out["classifier_asr"] = _safe_float(classifier.get("asr"))
        out["n_unparsed_classifier"] = classifier.get("n_unparsed", 0)

    sorry = _read_json(metrics_dir / "sorry_bench__fulfillment__sorry_judge.json")
    if sorry:
        out["sorry_fulfillment"] = _safe_float(sorry.get("fulfillment"))
        out["n_unparsed_sorry"] = sorry.get("n_unparsed", 0)

    xstest = _read_json(metrics_dir / "xstest_safe__xstest__gpt4o_mini.json")
    if xstest:
        out["over_refusal"] = _safe_float(xstest.get("over_refusal"))
        out["full_refusal"] = _safe_float(xstest.get("full_refusal"))
        out["n_errors_xstest"] = xstest.get("n_errors", 0)

    heldout = _read_json(metrics_dir / "heldout_nll.json")
    if heldout:
        out["perplexity"] = _safe_float(heldout.get("perplexity"))
        out["nll"] = _safe_float(heldout.get("nll"))

    capability = _read_json(metrics_dir / "capability.json")
    if capability and isinstance(capability.get("ifeval"), dict):
        out["ifeval"] = _safe_float(
            capability["ifeval"].get("prompt_level_strict_acc,none")
        )

    tail = _read_json(metrics_dir / "tail_loss.json")
    if tail:
        out["tail_loss"] = _safe_float(tail.get("share_above_reference_p95"))

    refusal = _read_json(metrics_dir / "refusal_direction.json")
    if refusal:
        out["refusal_gap"] = _safe_float(refusal.get("max_gap"))
        out["refusal_best_layer"] = refusal.get("best_layer")

    audit = _read_json(metrics_dir / "synthetic_audit.json")
    if audit:
        out["synthetic_empty_rate"] = _safe_float(audit.get("empty_rate"))
        out["synthetic_truncated_rate"] = _safe_float(audit.get("truncated_rate"))
        out["synthetic_distinct_2"] = _safe_float(audit.get("distinct_2"))

    # Jailbreak / robust ASRs when present
    for job, key in [
        ("harmbench_test_at_jb_aim", "jb_aim"),
        ("harmbench_test_at_jb_prefix_injection", "jb_prefix"),
        ("harmbench_test_at_jb_refusal_suppression", "jb_refusal"),
        ("harmbench_test_at_robust", "robust"),
    ]:
        blob = _read_json(metrics_dir / f"{job}__strongreject__gpt4o_mini.json")
        if blob:
            out[key] = _safe_float(blob.get("asr"))

    return out


def extract_health(node_dir: Path, metrics: dict[str, Any]) -> dict[str, Any]:
    health = {
        "n_errors": int(metrics.get("n_errors_primary") or 0)
        + int(metrics.get("n_errors_secondary") or 0)
        + int(metrics.get("n_errors_xstest") or 0),
        "n_judge_refused": int(metrics.get("n_judge_refused_primary") or 0)
        + int(metrics.get("n_judge_refused_secondary") or 0),
        "n_unparsed": int(metrics.get("n_unparsed_classifier") or 0)
        + int(metrics.get("n_unparsed_sorry") or 0),
        "empty_rate": metrics.get("empty_rate"),
        "length_hits": 0,
        "n_completions": 0,
    }
    # Cheap scan of completion finish reasons (no answer text stored).
    eval_dir = node_dir / "eval"
    if eval_dir.is_dir():
        for job_dir in eval_dir.iterdir():
            if not job_dir.is_dir():
                continue
            path = job_dir / "completions.jsonl"
            if not path.is_file():
                continue
            try:
                with path.open(encoding="utf-8") as fh:
                    for line in fh:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            row = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        health["n_completions"] += 1
                        if row.get("finish_reason") == "length":
                            health["length_hits"] += 1
            except OSError as exc:
                print(f"warn: completions scan {path}: {exc}", file=sys.stderr)
    return health


def extract_train_stats(manifest: dict[str, Any] | None) -> dict[str, Any] | None:
    if not manifest:
        return None
    train = (manifest.get("stages") or {}).get("train")
    if not isinstance(train, dict):
        return None
    keep = [
        "examples",
        "optimizer_steps",
        "final_loss",
        "train_seconds",
        "peak_memory_gb",
        "response_tokens",
        "world_size",
        "finished",
    ]
    out = {k: train.get(k) for k in keep if k in train}
    env = train.get("environment")
    if isinstance(env, dict):
        out["environment"] = {
            k: env.get(k)
            for k in ("pytorch", "transformers", "cuda", "gpu_name")
            if k in env
        }
    return out


def discover_nodes(data_root: Path) -> list[NodeRec]:
    runs = data_root / "runs"
    nodes: list[NodeRec] = []
    if not runs.is_dir():
        return nodes

    for study_dir in sorted(runs.iterdir()):
        if not study_dir.is_dir():
            continue
        study = study_dir.name
        # model dirs: any immediate child that is a directory and not results/
        for model_dir in sorted(study_dir.iterdir()):
            if not model_dir.is_dir() or model_dir.name in {"results"}:
                continue
            # skip non-model config-ish? protocol is file; configs are files
            for manifest_path in model_dir.rglob("manifest.json"):
                node_dir = manifest_path.parent
                parsed = parse_node_path(study, model_dir, node_dir)
                if not parsed:
                    print(f"warn: skip unparsed node {node_dir}", file=sys.stderr)
                    continue
                stages = sorted(
                    p.name for p in (node_dir / ".done").iterdir()
                ) if (node_dir / ".done").is_dir() else []
                metrics = extract_metrics(node_dir / "metrics")
                health = extract_health(node_dir, metrics)
                manifest = _read_json(manifest_path)
                rel = str(node_dir.relative_to(data_root))
                node_id = f"{study}:{parsed['label']}"
                if parsed["seed"] is not None:
                    node_id = f"{study}:seed{parsed['seed']}:{parsed['label']}"
                elif parsed["model"]:
                    node_id = f"{study}:{parsed['model']}:{parsed['label']}"
                nodes.append(
                    NodeRec(
                        node_id=node_id,
                        study=study,
                        model=parsed["model"],
                        seed=parsed["seed"],
                        arm=parsed["arm"],
                        generation=parsed["generation"],
                        label=parsed["label"],
                        rel_path=rel,
                        stages=stages,
                        metrics=metrics,
                        health=health,
                        has_train=(node_dir / "train.jsonl").is_file(),
                        has_synthetic=(node_dir / "synthetic.jsonl").is_file(),
                        train_stats=extract_train_stats(manifest),
                    )
                )
    return nodes


def load_summary_csv(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def load_node_metrics_csv(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def load_confirmatory(path: Path) -> Any | None:
    return _read_json(path)


def load_tracking(path: Path) -> Any | None:
    return _read_json(path)


def series_for_study(
    nodes: list[NodeRec], arms: list[str], metric_id: str
) -> dict[str, Any]:
    """Build per-arm generation series with mean and min/max over seeds."""
    # Points keyed by (arm_line, generation) -> list of (seed, value)
    # G0/G1 are shared onto every arm line.
    by_arm: dict[str, dict[int, list[tuple[int | None, float]]]] = {
        a: defaultdict(list) for a in arms
    }

    for node in nodes:
        value = node.metrics.get(metric_id)
        if value is None:
            continue
        if node.generation == 0 or node.arm in (None, "base", "shared") or node.generation == 1:
            for arm in arms:
                by_arm[arm][node.generation].append((node.seed, float(value)))
        elif node.arm in by_arm:
            by_arm[node.arm][node.generation].append((node.seed, float(value)))

    out: dict[str, Any] = {}
    for arm, gens in by_arm.items():
        points = []
        for gen in sorted(gens):
            vals = gens[gen]
            # Deduplicate G0 (single node) if appended once per arm already OK;
            # for G1, three seeds — keep all. If G0 somehow duplicated, uniq by seed.
            seen: dict[int | None, float] = {}
            for seed, val in vals:
                seen[seed] = val
            numbers = list(seen.values())
            mean = sum(numbers) / len(numbers)
            points.append(
                {
                    "generation": gen,
                    "mean": mean,
                    "min": min(numbers),
                    "max": max(numbers),
                    "seeds": [
                        {"seed": s, "value": v}
                        for s, v in sorted(seen.items(), key=lambda x: (x[0] is None, x[0]))
                    ],
                }
            )
        out[arm] = points
    return out


def scatter_points(nodes: list[NodeRec]) -> list[dict[str, Any]]:
    pts = []
    for node in nodes:
        asr = node.metrics.get("asr_primary")
        ppl = node.metrics.get("perplexity")
        if asr is None or ppl is None:
            continue
        arm = node.arm
        if arm in (None, "base"):
            arm = "shared"
        pts.append(
            {
                "node_id": node.node_id,
                "seed": node.seed,
                "arm": arm,
                "generation": node.generation,
                "label": node.label,
                "asr": asr,
                "perplexity": ppl,
            }
        )
    return pts


def _mean(vals: list[float]) -> float | None:
    return sum(vals) / len(vals) if vals else None


def headline_from_summary(summary: list[dict[str, Any]], label: str) -> dict[str, Any]:
    """Key paper numbers for a checkpoint label from summary.csv."""
    out: dict[str, Any] = {"label": label}

    def find(job: str, task: str, judge: str) -> dict[str, Any] | None:
        for row in summary:
            if (
                row.get("label") == label
                and row.get("job") == job
                and row.get("task") == task
                and row.get("judge") == judge
            ):
                return row
        return None

    primary = find("harmbench_test", "strongreject", "gpt4o_mini")
    if primary:
        out["asr"] = _safe_float(primary.get("asr"))
        out["mean_score"] = _safe_float(primary.get("mean_score"))
        out["refusal_rate"] = _safe_float(primary.get("refusal_rate"))

    xstest = find("xstest_safe", "xstest", "gpt4o_mini")
    if xstest:
        # summary stores over-refusal in refusal_rate for xstest rows
        out["over_refusal"] = _safe_float(xstest.get("refusal_rate"))

    sorry = find("sorry_bench", "fulfillment", "sorry_judge")
    if sorry:
        out["sorry_fulfillment"] = _safe_float(sorry.get("mean_score"))

    return out


def headline_from_nodes(nodes: list[NodeRec], label: str) -> dict[str, Any]:
    """Fallback aggregates when summary.csv has not caught up (e.g. Gen 6–10)."""
    subset = [n for n in nodes if n.label == label]
    out: dict[str, Any] = {"label": label, "source": "nodes"}
    if not subset:
        return out
    out["asr"] = _mean(
        [float(n.metrics["asr_primary"]) for n in subset if n.metrics.get("asr_primary") is not None]
    )
    out["mean_score"] = _mean(
        [float(n.metrics["mean_score"]) for n in subset if n.metrics.get("mean_score") is not None]
    )
    out["refusal_rate"] = _mean(
        [float(n.metrics["refusal_rate"]) for n in subset if n.metrics.get("refusal_rate") is not None]
    )
    out["over_refusal"] = _mean(
        [float(n.metrics["over_refusal"]) for n in subset if n.metrics.get("over_refusal") is not None]
    )
    out["sorry_fulfillment"] = _mean(
        [
            float(n.metrics["sorry_fulfillment"])
            for n in subset
            if n.metrics.get("sorry_fulfillment") is not None
        ]
    )
    return out


def ppl_ifeval_for_label(nodes: list[NodeRec], label: str) -> dict[str, Any]:
    subset = [n for n in nodes if n.label == label]
    ppls = [n.metrics["perplexity"] for n in subset if n.metrics.get("perplexity") is not None]
    ifevals = [n.metrics["ifeval"] for n in subset if n.metrics.get("ifeval") is not None]
    out: dict[str, Any] = {}
    if ppls:
        out["perplexity"] = sum(ppls) / len(ppls)
    if ifevals:
        out["ifeval"] = sum(ifevals) / len(ifevals)
    out["n_seeds"] = len({n.seed for n in subset if n.seed is not None}) or (
        1 if any(n.seed is None for n in subset) else 0
    )
    return out


def jailbreak_matrix(summary: list[dict[str, Any]]) -> dict[str, Any]:
    templates = [
        ("plain", "harmbench_test"),
        ("aim", "harmbench_test@jb_aim"),
        ("prefix_injection", "harmbench_test@jb_prefix_injection"),
        ("refusal_suppression", "harmbench_test@jb_refusal_suppression"),
    ]
    labels = ["G0", "G1", "R5", "S5", "A5", "R10", "S10", "A10"]
    grid: dict[str, dict[str, float | None]] = {}
    for label in labels:
        row: dict[str, float | None] = {}
        any_val = False
        for name, job in templates:
            val = None
            for r in summary:
                if (
                    r.get("label") == label
                    and r.get("job") == job
                    and r.get("task") == "strongreject"
                    and r.get("judge") == "gpt4o_mini"
                ):
                    val = _safe_float(r.get("asr"))
                    break
            row[name] = val
            if val is not None:
                any_val = True
        if any_val:
            grid[label] = row
    return grid


def jailbreak_matrix_from_nodes(nodes: list[NodeRec]) -> dict[str, Any]:
    """Fill jailbreak ASR from per-node metrics (needed for Gen 10 when summary lags)."""
    key_map = {
        "plain": "asr_primary",
        "aim": "jb_aim",
        "prefix_injection": "jb_prefix",
        "refusal_suppression": "jb_refusal",
    }
    labels = ["G0", "G1", "R5", "S5", "A5", "R10", "S10", "A10"]
    grid: dict[str, dict[str, float | None]] = {}
    for label in labels:
        subset = [n for n in nodes if n.label == label]
        if not subset:
            continue
        row: dict[str, float | None] = {}
        any_val = False
        for name, metric in key_map.items():
            vals = [
                float(n.metrics[metric])
                for n in subset
                if n.metrics.get(metric) is not None
            ]
            val = _mean(vals)
            row[name] = val
            if val is not None:
                any_val = True
        if any_val:
            grid[label] = row
    return grid


def merge_jailbreaks(
    from_summary: dict[str, Any], from_nodes: dict[str, Any]
) -> dict[str, Any]:
    out: dict[str, Any] = dict(from_summary)
    for label, row in from_nodes.items():
        if label not in out:
            out[label] = row
            continue
        merged = dict(out[label])
        for k, v in row.items():
            if merged.get(k) is None and v is not None:
                merged[k] = v
        out[label] = merged
    return out


def compute_deltas(headlines: dict[str, Any]) -> list[dict[str, Any]]:
    """Paper-aligned story deltas for the overview strip."""
    specs = [
        ("G0 → G1", "G0", "G1", "First fine-tune (most of the damage)"),
        ("G1 → R5", "G1", "R5", "Replace recursion to Gen 5"),
        ("R5 → R10", "R5", "R10", "Late collapse (exploratory)"),
        ("G1 → S5", "G1", "S5", "Subsample to Gen 5"),
        ("G1 → A5", "G1", "A5", "Accumulate to Gen 5"),
        ("R5 → A5", "R5", "A5", "H3 contrast (base)"),
        ("R5 → S5", "R5", "S5", "H3 contrast (IT)"),
    ]
    out: list[dict[str, Any]] = []
    for title, a, b, note in specs:
        ha, hb = headlines.get(a), headlines.get(b)
        if not ha or not hb:
            continue
        asr_a, asr_b = ha.get("asr"), hb.get("asr")
        ppl_a, ppl_b = ha.get("perplexity"), hb.get("perplexity")
        if asr_a is None and ppl_a is None:
            continue
        out.append(
            {
                "id": f"{a}_{b}",
                "title": title,
                "note": note,
                "from": a,
                "to": b,
                "delta_asr": None if asr_a is None or asr_b is None else asr_b - asr_a,
                "delta_ppl": None if ppl_a is None or ppl_b is None else ppl_b - ppl_a,
                "asr_from": asr_a,
                "asr_to": asr_b,
                "ppl_from": ppl_a,
                "ppl_to": ppl_b,
            }
        )
    return out


def late_collapse_table(nodes: list[NodeRec], arms: list[str]) -> dict[str, Any]:
    """Exploratory Gen 1/5–10 table matching paper Table VI shape."""
    want_gens = [1, 5, 6, 7, 8, 9, 10]
    by_arm: dict[str, list[dict[str, Any]]] = {a: [] for a in arms}
    has_late = any(n.generation > 5 for n in nodes)
    if not has_late:
        return {"available": False, "arms": by_arm, "note": "No Gen 6–10 checkpoints in this export."}

    for arm in arms:
        for gen in want_gens:
            if gen == 1:
                subset = [n for n in nodes if n.generation == 1]
            else:
                subset = [n for n in nodes if n.arm == arm and n.generation == gen]
            if not subset:
                continue
            seeds = sorted({n.seed for n in subset if n.seed is not None})
            by_arm[arm].append(
                {
                    "generation": gen,
                    "n_seeds": len(seeds) or 1,
                    "seeds": seeds,
                    "asr": _mean(
                        [
                            float(n.metrics["asr_primary"])
                            for n in subset
                            if n.metrics.get("asr_primary") is not None
                        ]
                    ),
                    "perplexity": _mean(
                        [
                            float(n.metrics["perplexity"])
                            for n in subset
                            if n.metrics.get("perplexity") is not None
                        ]
                    ),
                    "over_refusal": _mean(
                        [
                            float(n.metrics["over_refusal"])
                            for n in subset
                            if n.metrics.get("over_refusal") is not None
                        ]
                    ),
                    "ifeval": _mean(
                        [
                            float(n.metrics["ifeval"])
                            for n in subset
                            if n.metrics.get("ifeval") is not None
                        ]
                    ),
                }
            )
    note = (
        "Exploratory late collapse. Instruction-tuned Gen 6–10 is seed 0 only; "
        "base Gen 6–10 uses all three seeds."
    )
    return {"available": True, "arms": by_arm, "note": note, "generations": want_gens}


def build_dashboard(
    study: str,
    nodes: list[NodeRec],
    data_root: Path,
) -> dict[str, Any]:
    meta = STUDY_META.get(study, {"title": study, "arms": ["replace", "subsample"]})
    arms: list[str] = list(meta.get("arms") or [])
    results_dir = data_root / "runs" / study / "results"
    model = meta.get("model")
    summary = load_summary_csv(results_dir / "summary.csv")
    node_metrics = load_node_metrics_csv(results_dir / "node_metrics.csv")
    confirmatory = None
    tracking = None
    if model:
        confirmatory = load_confirmatory(results_dir / f"confirmatory_{model}.json")
        tracking = load_tracking(results_dir / f"tracking_{model}.json")

    study_nodes = [n for n in nodes if n.study == study]
    series = {m["id"]: series_for_study(study_nodes, arms, m["id"]) for m in METRIC_DEFS}

    headlines: dict[str, Any] = {}
    for label in ("G0", "G1", "R5", "S5", "A5", "R10", "S10", "A10"):
        h = headline_from_summary(summary, label) if summary else {"label": label}
        if h.get("asr") is None:
            node_h = headline_from_nodes(study_nodes, label)
            for key, val in node_h.items():
                if key == "label":
                    continue
                if h.get(key) is None and val is not None:
                    h[key] = val
        h.update(ppl_ifeval_for_label(study_nodes, label))
        if h.get("asr") is not None or h.get("perplexity") is not None:
            headlines[label] = h

    jb = jailbreak_matrix(summary) if summary else {}
    jb = merge_jailbreaks(jb, jailbreak_matrix_from_nodes(study_nodes))

    # Completeness: expected stages for a full eval node (heuristic)
    expected_core = {
        "gen__harmbench_test",
        "judge__harmbench_test__strongreject__gpt4o_mini",
        "heldout_nll",
        "capability",
    }
    incomplete = []
    for n in study_nodes:
        missing = sorted(expected_core - set(n.stages))
        if missing and n.generation >= 0:
            incomplete.append({"node_id": n.node_id, "missing": missing})

    health_rows = [
        {
            "node_id": n.node_id,
            "label": n.label,
            "seed": n.seed,
            "arm": n.arm,
            **n.health,
        }
        for n in sorted(
            study_nodes,
            key=lambda x: (x.generation, x.arm or "", x.seed if x.seed is not None else -1),
        )
    ]

    seeds = sorted({n.seed for n in study_nodes if n.seed is not None})
    max_gen = max((n.generation for n in study_nodes), default=0)
    return {
        "study": study,
        "title": meta.get("title", study),
        "model": model,
        "invalid": bool(meta.get("invalid")),
        "arms": arms,
        "metric_defs": METRIC_DEFS,
        "n_nodes": len(study_nodes),
        "seeds": seeds,
        "max_generation": max_gen,
        "headlines": headlines,
        "deltas": compute_deltas(headlines),
        "series": series,
        "scatter": scatter_points(study_nodes),
        "jailbreaks": jb,
        "confirmatory": confirmatory,
        "tracking": tracking,
        "late_collapse": late_collapse_table(study_nodes, arms),
        "summary": summary,
        "has_results": bool(summary) or bool(node_metrics),
        "incomplete": incomplete,
        "health": health_rows,
        "nodes": [
            {
                "node_id": n.node_id,
                "seed": n.seed,
                "arm": n.arm,
                "generation": n.generation,
                "label": n.label,
                "rel_path": n.rel_path,
                "stages": n.stages,
                "has_train": n.has_train,
                "has_synthetic": n.has_synthetic,
                "train_stats": n.train_stats,
                "metrics": n.metrics,
                "health": n.health,
            }
            for n in sorted(
                study_nodes,
                key=lambda x: (
                    x.generation,
                    x.arm or "",
                    x.seed if x.seed is not None else -1,
                ),
            )
        ],
    }


def count_prompts(data_root: Path) -> dict[str, int]:
    out = {}
    data_dir = data_root / "data"
    for name in ("harmbench_test", "xstest_safe", "sorry_bench"):
        path = data_dir / f"{name}.jsonl"
        if path.is_file():
            with path.open(encoding="utf-8") as fh:
                out[name] = sum(1 for line in fh if line.strip())
        else:
            out[name] = 0
    out["total_eval"] = sum(out.values())
    return out


def init_db(db_path: Path) -> sqlite3.Connection:
    if db_path.exists():
        db_path.unlink()
    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE nodes (
          node_id TEXT PRIMARY KEY,
          study TEXT NOT NULL,
          model TEXT NOT NULL,
          seed INTEGER,
          arm TEXT,
          generation INTEGER NOT NULL,
          label TEXT NOT NULL,
          rel_path TEXT NOT NULL,
          stages_json TEXT NOT NULL,
          metrics_json TEXT NOT NULL,
          health_json TEXT NOT NULL,
          has_train INTEGER NOT NULL,
          has_synthetic INTEGER NOT NULL,
          train_stats_json TEXT
        );
        CREATE INDEX idx_nodes_study ON nodes(study);
        CREATE TABLE prompts (
          id TEXT NOT NULL,
          benchmark TEXT NOT NULL,
          text TEXT NOT NULL,
          meta_json TEXT NOT NULL,
          PRIMARY KEY (benchmark, id)
        );
        CREATE TABLE files (
          path TEXT PRIMARY KEY,
          mtime REAL NOT NULL,
          size INTEGER NOT NULL
        );
        CREATE TABLE scores (
          study TEXT NOT NULL,
          model TEXT,
          seed INTEGER,
          arm TEXT,
          generation INTEGER,
          label TEXT NOT NULL,
          job TEXT NOT NULL,
          task TEXT,
          judge TEXT NOT NULL,
          prompt_id TEXT NOT NULL,
          sample INTEGER NOT NULL DEFAULT 0,
          score REAL,
          refused REAL,
          specific REAL,
          convincing REAL,
          refusal_label TEXT,
          judge_refused INTEGER,
          error TEXT
        );
        CREATE INDEX idx_scores_lookup ON scores(study, job, label, seed, prompt_id);
        CREATE INDEX idx_scores_prompt ON scores(study, prompt_id, job);
        """
    )
    return conn


def _score_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def index_scores_long(conn: sqlite3.Connection, study: str, path: Path) -> int:
    """Ingest runs/<study>/results/scores_long.csv.gz (prompt ids only, no answer text)."""
    if not path.is_file():
        return 0
    opener = gzip.open if path.suffix == ".gz" or path.name.endswith(".csv.gz") else open
    n = 0
    with opener(path, "rt", encoding="utf-8", newline="") as fh:  # type: ignore[arg-type]
        reader = csv.DictReader(fh)
        batch: list[tuple[Any, ...]] = []
        for row in reader:
            seed_raw = row.get("seed") or ""
            seed = None
            if seed_raw != "":
                seed = int(float(seed_raw))
            batch.append(
                (
                    study,
                    row.get("model"),
                    seed,
                    row.get("arm") or None,
                    _score_int(row.get("generation")),
                    row.get("label"),
                    row.get("job"),
                    row.get("task"),
                    row.get("judge"),
                    row.get("prompt"),
                    _score_int(row.get("sample")) or 0,
                    _safe_float(row.get("score")),
                    _safe_float(row.get("refused")),
                    _safe_float(row.get("specific")),
                    _safe_float(row.get("convincing")),
                    row.get("refusal_label") or None,
                    _score_int(row.get("judge_refused")) or 0,
                    row.get("error") or None,
                )
            )
            if len(batch) >= 5000:
                conn.executemany(
                    """
                    INSERT INTO scores(
                      study, model, seed, arm, generation, label, job, task, judge,
                      prompt_id, sample, score, refused, specific, convincing,
                      refusal_label, judge_refused, error
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    batch,
                )
                n += len(batch)
                batch.clear()
        if batch:
            conn.executemany(
                """
                INSERT INTO scores(
                  study, model, seed, arm, generation, label, job, task, judge,
                  prompt_id, sample, score, refused, specific, convincing,
                  refusal_label, judge_refused, error
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                batch,
            )
            n += len(batch)
    return n


def _insert_score_batch(conn: sqlite3.Connection, batch: list[tuple[Any, ...]]) -> None:
    conn.executemany(
        """
        INSERT INTO scores(
          study, model, seed, arm, generation, label, job, task, judge,
          prompt_id, sample, score, refused, specific, convincing,
          refusal_label, judge_refused, error
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        batch,
    )


def index_scores_from_nodes(
    conn: sqlite3.Connection,
    data_root: Path,
    study: str,
    nodes: list[NodeRec],
    *,
    only_generations: set[int] | None = None,
) -> int:
    """Read per-node verdict JSONL into scores (full fallback, or late-gen supplement)."""
    n = 0
    study_nodes = [node for node in nodes if node.study == study]
    if only_generations is not None:
        study_nodes = [node for node in study_nodes if node.generation in only_generations]
    batch: list[tuple[Any, ...]] = []
    for node in study_nodes:
        eval_root = data_root / node.rel_path / "eval"
        if not eval_root.is_dir():
            continue
        for job_dir in eval_root.iterdir():
            if not job_dir.is_dir():
                continue
            job = job_dir.name.replace("_at_", "@", 1) if "_at_" in job_dir.name else job_dir.name
            for path in job_dir.glob("*.jsonl"):
                if path.name == "completions.jsonl":
                    continue
                # filename: <task>__<judge>.jsonl
                stem = path.name[: -len(".jsonl")]
                if "__" not in stem:
                    continue
                task, judge = stem.split("__", 1)
                try:
                    with path.open(encoding="utf-8") as fh:
                        for line in fh:
                            line = line.strip()
                            if not line:
                                continue
                            try:
                                row = json.loads(line)
                            except json.JSONDecodeError:
                                continue
                            rid = str(row.get("id") or "")
                            sample = int(row.get("sample") or 0)
                            if "#" in rid:
                                base, _, suf = rid.partition("#")
                                rid = base
                                if suf.isdigit():
                                    sample = int(suf)
                            score = row.get("score")
                            if score is None and "fulfilled" in row:
                                score = row.get("fulfilled")
                            if score is None and "harmful" in row:
                                score = row.get("harmful")
                            batch.append(
                                (
                                    study,
                                    node.model,
                                    node.seed,
                                    node.arm,
                                    node.generation,
                                    node.label,
                                    job,
                                    row.get("task") or task,
                                    row.get("judge") or judge,
                                    rid,
                                    sample,
                                    _safe_float(score),
                                    _safe_float(row.get("refused")),
                                    _safe_float(row.get("specific")),
                                    _safe_float(row.get("convincing")),
                                    row.get("refusal_label") or row.get("label"),
                                    int(row.get("judge_refused") or 0),
                                    row.get("error"),
                                )
                            )
                            if len(batch) >= 5000:
                                _insert_score_batch(conn, batch)
                                n += len(batch)
                                batch.clear()
                except OSError as exc:
                    print(f"warn: scores from {path}: {exc}", file=sys.stderr)
    if batch:
        _insert_score_batch(conn, batch)
        n += len(batch)
    return n


def index_all_scores(
    conn: sqlite3.Connection, data_root: Path, nodes: list[NodeRec], studies: list[str]
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for study in studies:
        path = data_root / "runs" / study / "results" / "scores_long.csv.gz"
        if path.is_file():
            n = index_scores_long(conn, study, path)
            # scores_long currently stops at Gen 5; pull Gen 6–10 from node verdicts.
            late = {n.generation for n in nodes if n.study == study and n.generation > 5}
            if late:
                n += index_scores_from_nodes(
                    conn, data_root, study, nodes, only_generations=late
                )
            counts[study] = n
        else:
            counts[study] = index_scores_from_nodes(conn, data_root, study, nodes)
    return counts


def build_judge_validation(data_root: Path) -> dict[str, Any] | None:
    path = data_root / "judge_validation" / "summary_with_ci.json"
    blob = _read_json(path)
    if not blob:
        return None
    return {
        "source": "judge_validation/summary_with_ci.json",
        "benchmarks": blob,
        "note": (
            "Agreement of each judge with human labels on held-out sets "
            "(JailbreakBench, SORRY-Bench, WildGuard). Primary = gpt4o_mini."
        ),
    }


def build_compare(dashboards: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Cross-study analytics payload for the Compare page."""
    primary = ["main", "base_model", "replication2"]
    studies = []
    for sid in primary:
        dash = dashboards.get(sid)
        if not dash:
            continue
        studies.append(
            {
                "study": sid,
                "title": dash.get("title"),
                "model": dash.get("model"),
                "arms": dash.get("arms"),
                "n_nodes": dash.get("n_nodes"),
                "max_generation": dash.get("max_generation"),
                "headlines": dash.get("headlines"),
                "deltas": dash.get("deltas"),
                "tracking": dash.get("tracking"),
                "confirmatory": {
                    "primary": (dash.get("confirmatory") or {}).get("primary"),
                    "robust": (dash.get("confirmatory") or {}).get("robust"),
                }
                if dash.get("confirmatory")
                else None,
                "series": {
                    "asr_primary": dash.get("series", {}).get("asr_primary"),
                    "perplexity": dash.get("series", {}).get("perplexity"),
                    "over_refusal": dash.get("series", {}).get("over_refusal"),
                    "ifeval": dash.get("series", {}).get("ifeval"),
                },
                "scatter": dash.get("scatter"),
                "late_collapse": dash.get("late_collapse"),
            }
        )
    return {
        "studies": studies,
        "finding": (
            "In every category the first fine-tune (G0→G1) moves harmful compliance most; "
            "recursive collapse then raises held-out perplexity while ASR stays nearly flat."
        ),
    }


def index_prompts(conn: sqlite3.Connection, data_root: Path) -> int:
    data_dir = data_root / "data"
    n = 0
    for name in ("harmbench_test", "xstest_safe", "sorry_bench"):
        path = data_dir / f"{name}.jsonl"
        if not path.is_file():
            continue
        with path.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                messages = row.get("messages") or []
                text = ""
                for msg in messages:
                    if msg.get("role") == "user":
                        text = msg.get("content") or ""
                        break
                conn.execute(
                    "INSERT OR REPLACE INTO prompts(id, benchmark, text, meta_json) VALUES (?,?,?,?)",
                    (
                        row["id"],
                        row.get("benchmark") or name,
                        text,
                        json.dumps(row.get("meta") or {}, ensure_ascii=False),
                    ),
                )
                n += 1
    return n


def fingerprint(conn: sqlite3.Connection, data_root: Path) -> None:
    """Record mtimes for manifests + results files to support incremental rebuilds later."""
    paths: list[Path] = []
    runs = data_root / "runs"
    if runs.is_dir():
        paths.extend(runs.rglob("manifest.json"))
        for study_dir in runs.iterdir():
            results = study_dir / "results"
            if results.is_dir():
                paths.extend(results.glob("*.csv"))
                paths.extend(results.glob("*.csv.gz"))
                paths.extend(results.glob("*.json"))
    for path in paths:
        try:
            st = path.stat()
        except OSError:
            continue
        rel = str(path.relative_to(data_root))
        conn.execute(
            "INSERT OR REPLACE INTO files(path, mtime, size) VALUES (?,?,?)",
            (rel, st.st_mtime, st.st_size),
        )


def build(data_root: Path, cache_dir: Path, studies: list[str] | None = None) -> dict[str, Any]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    db_path = cache_dir / "index.sqlite"
    t0 = time.time()
    print(f"indexing {data_root} -> {cache_dir}")

    exported_at = None
    exported_path = data_root / "EXPORTED_AT"
    if exported_path.is_file():
        exported_at = exported_path.read_text(encoding="utf-8").strip()

    nodes = discover_nodes(data_root)
    print(f"  discovered {len(nodes)} nodes")

    conn = init_db(db_path)
    for n in nodes:
        conn.execute(
            """
            INSERT INTO nodes(
              node_id, study, model, seed, arm, generation, label, rel_path,
              stages_json, metrics_json, health_json, has_train, has_synthetic, train_stats_json
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                n.node_id,
                n.study,
                n.model,
                n.seed,
                n.arm,
                n.generation,
                n.label,
                n.rel_path,
                json.dumps(n.stages),
                json.dumps(n.metrics),
                json.dumps(n.health),
                int(n.has_train),
                int(n.has_synthetic),
                json.dumps(n.train_stats) if n.train_stats else None,
            ),
        )
    n_prompts = index_prompts(conn, data_root)
    print(f"  indexed {n_prompts} prompts")

    studies_present = sorted({n.study for n in nodes})
    if studies:
        studies_present = [s for s in studies_present if s in studies]

    score_counts = index_all_scores(conn, data_root, nodes, studies_present)
    for study, count in score_counts.items():
        print(f"  scores {study}: {count} rows")

    fingerprint(conn, data_root)
    prompt_counts = count_prompts(data_root)

    dashboards_dir = cache_dir / "dashboards"
    dashboards_dir.mkdir(exist_ok=True)
    built = []
    dashboards: dict[str, dict[str, Any]] = {}
    for study in studies_present:
        dash = build_dashboard(study, nodes, data_root)
        dashboards[study] = dash
        out_path = dashboards_dir / f"{study}.json"
        out_path.write_text(_dumps(dash), encoding="utf-8")
        built.append(study)
        print(f"  dashboard {study}: {dash['n_nodes']} nodes (max gen {dash.get('max_generation')})")

    compare = build_compare(dashboards)
    (cache_dir / "compare.json").write_text(_dumps(compare), encoding="utf-8")

    judge_validation = build_judge_validation(data_root)
    if judge_validation:
        (cache_dir / "judge_validation.json").write_text(
            _dumps(judge_validation), encoding="utf-8"
        )
        print("  judge_validation indexed")
    else:
        print("  warn: judge_validation summary missing", file=sys.stderr)

    # Global catalogue for the front end shell
    catalogue = {
        "schema_version": SCHEMA_VERSION,
        "exported_at": exported_at,
        "data_root": str(data_root),
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "prompt_counts": prompt_counts,
        "studies": [
            {
                "id": s,
                **{k: STUDY_META.get(s, {}).get(k) for k in ("title", "primary", "invalid", "model", "arms")},
                "n_nodes": sum(1 for n in nodes if n.study == s),
                "max_generation": max(
                    (n.generation for n in nodes if n.study == s), default=0
                ),
            }
            for s in sorted(
                studies_present,
                key=lambda x: (
                    0 if x == "main" else 1 if STUDY_META.get(x, {}).get("primary") and not STUDY_META.get(x, {}).get("invalid") else 2,
                    x,
                ),
            )
        ],
        "n_nodes_total": len(nodes),
        # Lower bound: primary StrongREJECT verdicts only (other judges add more).
        "judge_calls_primary": sum(int(n.metrics.get("n_primary") or 0) for n in nodes),
        "has_judge_validation": bool(judge_validation),
        "has_compare": True,
    }

    (cache_dir / "catalogue.json").write_text(
        _dumps(catalogue, indent=2), encoding="utf-8"
    )

    conn.execute(
        "INSERT INTO meta(key, value) VALUES (?, ?)",
        ("catalogue", _dumps({"schema_version": SCHEMA_VERSION, "exported_at": exported_at})),
    )
    conn.commit()
    conn.close()

    elapsed = time.time() - t0
    print(f"done in {elapsed:.1f}s -> {db_path}")
    return catalogue


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data",
        type=Path,
        default=Path(os.environ.get("SAFECOLLAPSE_DATA", DEFAULT_DATA)),
        help="read-only data root",
    )
    parser.add_argument(
        "--cache",
        type=Path,
        default=Path(__file__).resolve().parent / CACHE_DIR_NAME,
        help="cache output directory",
    )
    parser.add_argument(
        "--study",
        action="append",
        dest="studies",
        help="limit to one or more studies (repeatable); default: all",
    )
    args = parser.parse_args()
    data_root = args.data.expanduser().resolve()
    if not data_root.is_dir():
        print(f"error: data root not found: {data_root}", file=sys.stderr)
        return 1
    build(data_root, args.cache.resolve(), studies=args.studies)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
