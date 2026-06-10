#!/usr/bin/env python3
"""Validate document-to-TTS VLM JSONL records."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

BLOCK_TYPES = {
    "heading",
    "paragraph",
    "list",
    "quote",
    "caption",
    "figure",
    "page-number",
    "footnote",
    "header-footer",
    "toc",
    "service",
    "unknown",
}


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


def validate_record(record: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    rid = record.get("id", "<unknown>")
    output = record.get("teacherOutput")
    if not isinstance(output, dict):
        return [f"{rid}: teacherOutput missing or not object"]
    if not isinstance(output.get("pageLanguage"), str) or not output.get(
        "pageLanguage"
    ):
        errors.append(f"{rid}: pageLanguage missing")
    blocks = output.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        return errors + [f"{rid}: blocks missing/empty"]
    ocr_ids = {b.get("id") for b in record.get("ocrBlocks", []) if isinstance(b, dict)}
    used_ocr: Counter[str] = Counter()
    for i, block in enumerate(blocks):
        prefix = f"{rid}.blocks[{i}]"
        btype = block.get("type")
        if btype not in BLOCK_TYPES:
            errors.append(f"{prefix}: invalid type {btype!r}")
        if not isinstance(block.get("text"), str) or not block["text"].strip():
            errors.append(f"{prefix}: text missing/empty")
        if not isinstance(block.get("isFigure"), bool):
            errors.append(f"{prefix}: isFigure must be bool")
        if not isinstance(block.get("isMainContent"), bool):
            errors.append(f"{prefix}: isMainContent must be bool")
        ids = block.get("ocrBlockIds")
        if not isinstance(ids, list) or not all(isinstance(v, str) for v in ids):
            errors.append(f"{prefix}: ocrBlockIds must be string[]")
        else:
            for oid in ids:
                used_ocr[oid] += 1
                if ocr_ids and oid not in ocr_ids:
                    errors.append(f"{prefix}: unknown ocrBlockId {oid}")
        if "level" in block and block.get("level") not in (1, 2):
            errors.append(f"{prefix}: level must be 1 or 2")
        if btype == "figure" and block.get("isFigure") is not True:
            errors.append(f"{prefix}: figure block must have isFigure=true")
        if btype != "figure" and block.get("isFigure") is True:
            errors.append(f"{prefix}: non-figure block has isFigure=true")
    duplicates = [oid for oid, count in used_ocr.items() if count > 1]
    if duplicates:
        errors.append(f"{rid}: duplicate OCR ids claimed: {duplicates[:5]}")
    return errors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("path")
    parser.add_argument("--max-errors", type=int, default=50)
    args = parser.parse_args()

    records = read_jsonl(Path(args.path))
    errors: list[str] = []
    block_counts: Counter[str] = Counter()
    language_counts: Counter[str] = Counter()
    status_counts: Counter[str] = Counter()
    for record in records:
        errors.extend(validate_record(record))
        annotation = record.get("annotation", {})
        if isinstance(annotation, dict):
            status_counts[str(annotation.get("status", "unknown"))] += 1
        output = record.get("teacherOutput")
        if isinstance(output, dict):
            language_counts[str(output.get("pageLanguage", "?"))] += 1
            blocks = output.get("blocks")
            if isinstance(blocks, list):
                for block in blocks:
                    if isinstance(block, dict):
                        block_counts[str(block.get("type", "?"))] += 1

    report = {
        "records": len(records),
        "errors": len(errors),
        "statuses": dict(sorted(status_counts.items())),
        "languages": dict(sorted(language_counts.items())),
        "blockTypes": dict(sorted(block_counts.items())),
        "totalBlocks": sum(block_counts.values()),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if errors:
        print("\nValidation errors:")
        for error in errors[: args.max_errors]:
            print(f"- {error}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
