#!/usr/bin/env python3
"""Merge silver annotations with visually reviewed gold overrides."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "ml" / "data"
ANNOTATIONS_DIR = DATA_DIR / "annotations"
DATASET_DIR = DATA_DIR / "dataset"
SILVER_PATH = ANNOTATIONS_DIR / "teacher_silver_300.jsonl"
FINAL_PATH = ANNOTATIONS_DIR / "teacher_final_300.jsonl"


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")


def sft_record(record: dict[str, Any]) -> dict[str, Any]:
    user_payload = {
        "pageNumber": record["pageNumber"],
        "totalPages": record["totalPages"],
        "context": record["context"],
        "ocrBlocks": record["ocrBlocks"],
    }
    return {
        "id": record["id"],
        "image": record["imagePath"],
        "messages": [
            {
                "role": "system",
                "content": "You are an OCR + TTS-normalization assistant for an audiobook generator. Inspect the page image and OCR layout hints. Return strict JSON matching VlmPageResult: {blocks, pageLanguage}.",
            },
            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
            {
                "role": "assistant",
                "content": json.dumps(record["teacherOutput"], ensure_ascii=False),
            },
        ],
        "split": record.get("split", "train"),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--silver", default=str(SILVER_PATH))
    parser.add_argument("--gold-glob", default="gold_part_*.jsonl")
    parser.add_argument("--output", default=str(FINAL_PATH))
    args = parser.parse_args()

    base = {record["id"]: record for record in read_jsonl(Path(args.silver))}
    gold_paths = sorted(ANNOTATIONS_DIR.glob(args.gold_glob))
    overrides = 0
    for path in gold_paths:
        for record in read_jsonl(path):
            if "id" not in record:
                raise SystemExit(f"{path}: gold record without id")
            base[record["id"]] = record
            overrides += 1

    records = sorted(
        base.values(), key=lambda r: (r.get("documentId", ""), r.get("pageNumber", 0))
    )
    write_jsonl(Path(args.output), records)
    write_jsonl(DATASET_DIR / "all_final.jsonl", records)
    for split in ("train", "val", "test"):
        write_jsonl(
            DATASET_DIR / f"{split}_final.jsonl",
            [r for r in records if r.get("split") == split],
        )

    sft = [sft_record(r) for r in records if isinstance(r.get("teacherOutput"), dict)]
    write_jsonl(DATASET_DIR / "sft_final.jsonl", sft)
    for split in ("train", "val", "test"):
        write_jsonl(
            DATASET_DIR / f"sft_{split}_final.jsonl",
            [r for r in sft if r.get("split") == split],
        )

    print(
        json.dumps(
            {
                "records": len(records),
                "goldOverrides": overrides,
                "goldFiles": [str(p) for p in gold_paths],
                "sftRecords": len(sft),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
