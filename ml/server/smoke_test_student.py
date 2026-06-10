#!/usr/bin/env python3
"""Start the real student server with a LoRA adapter and run a tiny GPU inference test."""

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
    post_json,
    read_jsonl,
    request_payload,
    write_jsonl,
)

DEFAULT_ADAPTER = (
    PROJECT_ROOT
    / "ml"
    / "train"
    / "outputs"
    / "qwen25vl-3b-document-to-tts-lora-usable"
)
DEFAULT_OUTPUT = PROJECT_ROOT / "ml" / "eval" / "student_smoke_predictions.jsonl"
DEFAULT_MODEL = "Qwen/Qwen2.5-VL-3B-Instruct"
CACHE_DIR = PROJECT_ROOT / "ml" / ".cache"


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
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--adapter", default=str(DEFAULT_ADAPTER))
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--limit", type=int, default=1)
    parser.add_argument("--max-new-tokens", type=int, default=1024)
    parser.add_argument("--ocr-text-chars", type=int, default=180)
    parser.add_argument("--max-ocr-blocks", type=int, default=64)
    parser.add_argument("--no-alias-ocr-ids", action="store_true")
    parser.add_argument("--startup-timeout-sec", type=float, default=30.0)
    parser.add_argument("--request-timeout-sec", type=int, default=900)
    args = parser.parse_args()

    adapter = Path(args.adapter)
    if not adapter.exists():
        raise FileNotFoundError(f"LoRA adapter directory does not exist: {adapter}")

    env = os.environ.copy()
    env.pop("READ_ME_STUDENT_STUB", None)
    env["READ_ME_STUDENT_MODEL"] = args.model
    env["READ_ME_LORA_ADAPTER"] = str(adapter)
    env["READ_ME_MAX_NEW_TOKENS"] = str(args.max_new_tokens)
    env["READ_ME_OCR_TEXT_CHARS"] = str(args.ocr_text_chars)
    env["READ_ME_MAX_OCR_BLOCKS"] = str(args.max_ocr_blocks)
    env["READ_ME_ALIAS_OCR_IDS"] = "0" if args.no_alias_ocr_ids else "1"
    env.setdefault("PYTHONPATH", str(PROJECT_ROOT))
    env.setdefault("HF_HOME", str(CACHE_DIR / "huggingface"))
    env.setdefault("HF_HUB_CACHE", str(CACHE_DIR / "huggingface" / "hub"))
    env.setdefault(
        "TRANSFORMERS_CACHE", str(CACHE_DIR / "huggingface" / "transformers")
    )
    env.setdefault("TORCH_HOME", str(CACHE_DIR / "torch"))

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
                f"{base_url}/analyze-page",
                request_payload(record),
                timeout=args.request_timeout_sec,
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
            process.wait(timeout=20)
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
