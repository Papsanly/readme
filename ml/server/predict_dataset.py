#!/usr/bin/env python3
"""Run a JSONL SFT dataset through the local student server.

This client uses only the Python standard library. It reads records created by
`ml/scripts/build_final_dataset.py`, sends each page to `/analyze-page`, and
writes prediction JSONL suitable for `ml/eval/evaluate_predictions.py`.
"""

from __future__ import annotations

import argparse
import base64
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATASET = PROJECT_ROOT / "ml" / "data" / "dataset" / "sft_test_final.jsonl"
DEFAULT_OUTPUT = PROJECT_ROOT / "ml" / "eval" / "student_predictions.jsonl"
DEFAULT_URL = "http://127.0.0.1:8000/analyze-page"


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as exc:
                raise SystemExit(f"{path}:{line_no}: invalid JSON: {exc}") from exc
            if not isinstance(value, dict):
                raise SystemExit(f"{path}:{line_no}: record must be an object")
            records.append(value)
    return records


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")


def load_user_payload(record: dict[str, Any]) -> dict[str, Any]:
    messages = record.get("messages")
    if not isinstance(messages, list) or len(messages) < 2:
        raise ValueError(f"{record.get('id', '<unknown>')}: missing SFT user message")
    user_message = messages[1]
    if not isinstance(user_message, dict):
        raise ValueError(
            f"{record.get('id', '<unknown>')}: user message is not an object"
        )
    content = user_message.get("content")
    if not isinstance(content, str):
        raise ValueError(
            f"{record.get('id', '<unknown>')}: user message content is not a string"
        )
    payload = json.loads(content)
    if not isinstance(payload, dict):
        raise ValueError(
            f"{record.get('id', '<unknown>')}: user payload is not an object"
        )
    return payload


def request_payload(record: dict[str, Any]) -> dict[str, Any]:
    image_path_value = record.get("image")
    if not isinstance(image_path_value, str) or not image_path_value:
        raise ValueError(f"{record.get('id', '<unknown>')}: missing image path")

    image_path = PROJECT_ROOT / image_path_value
    if not image_path.exists():
        raise FileNotFoundError(f"image does not exist: {image_path}")

    user_payload = load_user_payload(record)
    image_base64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return {
        "imageBase64": image_base64,
        "imageMimeType": "image/png",
        "context": user_payload.get("context", {}),
        "pageNumber": user_payload.get("pageNumber"),
        "totalPages": user_payload.get("totalPages"),
        "ocrBlocks": user_payload.get("ocrBlocks", []),
    }


def post_json(url: str, payload: dict[str, Any], timeout: int) -> dict[str, Any]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {body[:1000]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"request failed: {exc}") from exc

    parsed = json.loads(body)
    if not isinstance(parsed, dict):
        raise RuntimeError("server response must be a JSON object")
    return parsed


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default=str(DEFAULT_DATASET))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument(
        "--limit", type=int, default=0, help="Optional max records to send"
    )
    parser.add_argument("--timeout", type=int, default=300)
    parser.add_argument("--sleep-sec", type=float, default=0.0)
    args = parser.parse_args()

    records = read_jsonl(Path(args.dataset))
    if args.limit > 0:
        records = records[: args.limit]

    predictions: list[dict[str, Any]] = []
    started = time.time()
    for index, record in enumerate(records, start=1):
        rid = record.get("id")
        if not isinstance(rid, str):
            raise ValueError(f"record {index}: missing id")
        payload = request_payload(record)
        prediction = post_json(args.url, payload, timeout=args.timeout)
        predictions.append({"id": rid, "prediction": prediction})
        print(
            f"[{index}/{len(records)}] {rid}: {len(prediction.get('blocks', []))} blocks"
        )
        if args.sleep_sec > 0:
            time.sleep(args.sleep_sec)

    write_jsonl(Path(args.output), predictions)
    elapsed = time.time() - started
    print(
        json.dumps(
            {
                "records": len(predictions),
                "output": args.output,
                "elapsedSec": round(elapsed, 3),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
