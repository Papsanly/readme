#!/usr/bin/env python3
"""Start the student server in stub mode and run a tiny contract test."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from ml.server.predict_dataset import (  # noqa: E402
    DEFAULT_DATASET,
    DEFAULT_OUTPUT,
    post_json,
    read_jsonl,
    request_payload,
    write_jsonl,
)


def wait_for_health(url: str, timeout_sec: float) -> dict[str, Any]:
    deadline = time.time() + timeout_sec
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                payload = json.loads(response.read().decode("utf-8"))
                if isinstance(payload, dict):
                    return payload
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            time.sleep(0.25)
    raise RuntimeError(f"server did not become healthy: {last_error}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default=str(DEFAULT_DATASET))
    parser.add_argument(
        "--output", default=str(DEFAULT_OUTPUT.parent / "stub_predictions.jsonl")
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--limit", type=int, default=3)
    parser.add_argument("--startup-timeout-sec", type=float, default=30.0)
    args = parser.parse_args()

    env = os.environ.copy()
    env["READ_ME_STUDENT_STUB"] = "1"
    env.setdefault("PYTHONPATH", str(PROJECT_ROOT))

    command = [
        sys.executable,
        "-m",
        "uvicorn",
        "ml.server.app:app",
        "--host",
        args.host,
        "--port",
        str(args.port),
        "--log-level",
        "warning",
    ]
    process = subprocess.Popen(
        command,
        cwd=PROJECT_ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    base_url = f"http://{args.host}:{args.port}"
    predictions: list[dict[str, Any]] = []
    try:
        health = wait_for_health(f"{base_url}/health", args.startup_timeout_sec)
        records = read_jsonl(Path(args.dataset))[: args.limit]
        for index, record in enumerate(records, start=1):
            rid = record.get("id")
            if not isinstance(rid, str):
                raise RuntimeError(f"record {index}: missing id")
            prediction = post_json(
                f"{base_url}/analyze-page", request_payload(record), timeout=120
            )
            predictions.append({"id": rid, "prediction": prediction})
            print(
                f"[{index}/{len(records)}] {rid}: {len(prediction.get('blocks', []))} blocks"
            )
        write_jsonl(Path(args.output), predictions)
        print(
            json.dumps(
                {"health": health, "records": len(predictions), "output": args.output},
                ensure_ascii=False,
                indent=2,
            )
        )
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)
        stdout = process.stdout.read() if process.stdout else ""
        stderr = process.stderr.read() if process.stderr else ""
        if stdout.strip():
            print("\n[uvicorn stdout]\n" + stdout.strip())
        if stderr.strip():
            print("\n[uvicorn stderr]\n" + stderr.strip())


if __name__ == "__main__":
    main()
