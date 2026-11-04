#!/usr/bin/env python3
"""Serve the safecollapse viewer on 127.0.0.1 only."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import trace_api

DEFAULT_DATA = Path.home() / "Workspace" / "safecollapse-viewer-data"
ROOT = Path(__file__).resolve().parent
CACHE = ROOT / ".cache"
DIST = ROOT / "dist"
HOST = "127.0.0.1"
PORT = 8765


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, cache_dir: Path, data_root: Path, **kwargs):
        self.cache_dir = cache_dir
        self.data_root = data_root
        super().__init__(*args, directory=str(DIST), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send_json(self, payload: object, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(self, body: bytes, content_type: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        q = trace_api.qs(parsed.query)

        if path == "/api/health":
            self._send_json({"ok": True, "host": HOST, "port": PORT})
            return

        if path == "/api/catalogue":
            cat = self.cache_dir / "catalogue.json"
            if not cat.is_file():
                self._send_json({"error": "index missing; run build_index.py"}, 503)
                return
            self._send_bytes(cat.read_bytes(), "application/json; charset=utf-8")
            return

        if path.startswith("/api/dashboard/"):
            study = path[len("/api/dashboard/") :].strip("/")
            if not study or "/" in study or ".." in study:
                self._send_json({"error": "bad study"}, 400)
                return
            dash = self.cache_dir / "dashboards" / f"{study}.json"
            if not dash.is_file():
                self._send_json({"error": "dashboard not found", "study": study}, 404)
                return
            self._send_bytes(dash.read_bytes(), "application/json; charset=utf-8")
            return

        if path == "/api/nodes":
            study = q.get("study", "main")
            try:
                conn = trace_api.open_db(self.cache_dir)
                try:
                    self._send_json(
                        {
                            "study": study,
                            "nodes": trace_api.list_nodes(conn, study),
                            "jobs": trace_api.available_jobs(conn, study),
                        }
                    )
                finally:
                    conn.close()
            except Exception as exc:  # noqa: BLE001
                self._send_json({"error": str(exc)}, 500)
            return

        if path == "/api/traces":
            study = q.get("study", "main")
            job = q.get("job", "harmbench_test")
            label = q.get("label", "G0")
            seed = trace_api._parse_optional_int(q.get("seed"))
            try:
                conn = trace_api.open_db(self.cache_dir)
                try:
                    payload = trace_api.list_traces(
                        conn,
                        study,
                        job=job,
                        label=label,
                        seed=seed,
                        q=q.get("q") or None,
                        filter_harmful=q.get("harmful") or None,
                        filter_disagree=q.get("disagree") == "1",
                        filter_judge_refused=q.get("judge_refused") == "1",
                        filter_error=q.get("error") == "1",
                        limit=int(q.get("limit") or 500),
                        offset=int(q.get("offset") or 0),
                    )
                    status = 404 if payload.get("error") else 200
                    self._send_json(payload, status)
                finally:
                    conn.close()
            except Exception as exc:  # noqa: BLE001
                self._send_json({"error": str(exc)}, 500)
            return

        if path == "/api/trace":
            study = q.get("study", "main")
            job = q.get("job", "harmbench_test")
            label = q.get("label", "G0")
            prompt_id = q.get("prompt")
            if not prompt_id:
                self._send_json({"error": "prompt required"}, 400)
                return
            seed = trace_api._parse_optional_int(q.get("seed"))
            sample = int(q.get("sample") or 0)
            try:
                conn = trace_api.open_db(self.cache_dir)
                try:
                    payload = trace_api.load_trace(
                        conn,
                        self.data_root,
                        study,
                        job=job,
                        label=label,
                        seed=seed,
                        prompt_id=prompt_id,
                        sample=sample,
                    )
                    status = 404 if payload.get("error") else 200
                    self._send_json(payload, status)
                finally:
                    conn.close()
            except Exception as exc:  # noqa: BLE001
                self._send_json({"error": str(exc)}, 500)
            return

        if path == "/api/trace/across":
            study = q.get("study", "main")
            job = q.get("job", "harmbench_test")
            prompt_id = q.get("prompt")
            if not prompt_id:
                self._send_json({"error": "prompt required"}, 400)
                return
            seed = trace_api._parse_optional_int(q.get("seed"))
            sample = int(q.get("sample") or 0)
            include_answers = q.get("answers", "1") != "0"
            try:
                conn = trace_api.open_db(self.cache_dir)
                try:
                    payload = trace_api.across_generations(
                        conn,
                        self.data_root,
                        study,
                        job=job,
                        prompt_id=prompt_id,
                        seed=seed,
                        sample=sample,
                        include_answers=include_answers,
                    )
                    self._send_json(payload)
                finally:
                    conn.close()
            except Exception as exc:  # noqa: BLE001
                self._send_json({"error": str(exc)}, 500)
            return

        # SPA fallback: serve index.html for non-file routes under /
        if path != "/" and not path.startswith("/api/") and not path.startswith("/assets/"):
            candidate = DIST / path.lstrip("/")
            if not candidate.is_file():
                index = DIST / "index.html"
                if index.is_file():
                    self._send_bytes(index.read_bytes(), "text/html; charset=utf-8")
                    return

        super().do_GET()


def ensure_index(data_root: Path, cache_dir: Path, force: bool) -> None:
    cat = cache_dir / "catalogue.json"
    db = cache_dir / "index.sqlite"
    needs = force or not cat.is_file() or not db.is_file()
    if not needs and db.is_file():
        # Rebuild if scores table missing (older cache).
        import sqlite3

        try:
            conn = sqlite3.connect(db)
            row = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='scores'"
            ).fetchone()
            conn.close()
            if not row:
                needs = True
        except sqlite3.Error:
            needs = True
    if needs:
        from build_index import build

        build(data_root, cache_dir)


def ensure_frontend(force: bool) -> None:
    index = DIST / "index.html"
    if force or not index.is_file():
        print("building frontend (vite)…")
        subprocess.check_call(["npm", "run", "build"], cwd=ROOT)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data",
        type=Path,
        default=Path(os.environ.get("SAFECOLLAPSE_DATA", DEFAULT_DATA)),
    )
    parser.add_argument("--cache", type=Path, default=CACHE)
    parser.add_argument("--host", default=HOST)
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--reindex", action="store_true", help="rebuild the index")
    parser.add_argument("--rebuild-ui", action="store_true", help="rebuild the frontend")
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="do not auto-build index/ui (fail if missing)",
    )
    args = parser.parse_args()

    if args.host not in ("127.0.0.1", "localhost"):
        print("error: refusing to bind to non-loopback host", file=sys.stderr)
        return 1

    data_root = args.data.expanduser().resolve()
    cache_dir = args.cache.resolve()

    if not args.skip_build:
        ensure_index(data_root, cache_dir, force=args.reindex)
        ensure_frontend(force=args.rebuild_ui)
    elif not (cache_dir / "catalogue.json").is_file() or not (DIST / "index.html").is_file():
        print("error: index or dist missing; run without --skip-build", file=sys.stderr)
        return 1

    handler = partial(Handler, cache_dir=cache_dir, data_root=data_root)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    url = f"http://{args.host}:{args.port}/"
    print(f"serving {url}")
    print("  Ctrl+C to stop")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
