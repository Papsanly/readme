#!/usr/bin/env python3
"""Generate a complete silver document-to-TTS dataset from DataLab layout.

This creates schema-valid `teacherOutput` records for all rendered pages that
have DataLab layout. It is intended as a full 300-page training artifact and a
starting point for visual teacher review. The highest-quality gold set is made by
reviewing/correcting these records against the PNG page images.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "ml" / "data"
DATALAB_DIR = DATA_DIR / "datalab"
INPUT_QUEUE = DATA_DIR / "visual_queue_with_datalab.jsonl"
ANNOTATIONS_DIR = DATA_DIR / "annotations"
DATASET_DIR = DATA_DIR / "dataset"

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

SERVICE_PATTERNS = [
    re.compile(pattern, re.IGNORECASE)
    for pattern in [
        r"\ball rights reserved\b",
        r"\bcopyright\b|©",
        r"\bisbn\b",
        r"\bprinted in\b",
        r"\bmcgraw\s*-?\s*hill\b",
        r"\bglencoe\b",
        r"\bpublisher\b",
        r"\blibrary of congress\b",
        r"\bперепечатк",
        r"\bтираж\b",
        r"\bредакц",
        r"\bиздател",
        r"\b版权所有\b",
        r"\bWestern Simulation\b",
    ]
]

TOC_PATTERNS = [
    re.compile(r"\.{3,}\s*\d+\s*$"),
    re.compile(r"\bcontents\b", re.IGNORECASE),
    re.compile(r"\btable of contents\b", re.IGNORECASE),
    re.compile(r"\bзміст\b|\bсодержание\b", re.IGNORECASE),
]

ABBREVIATION_REPLACEMENTS = [
    (re.compile(r"\bPDF\b"), "P D F"),
    (re.compile(r"\bHTML\b"), "H T M L"),
    (re.compile(r"\bCPU\b"), "C P U"),
    (re.compile(r"\bRAM\b"), "R A M"),
    (re.compile(r"\bROM\b"), "R O M"),
    (re.compile(r"\bI/O\b"), "input/output"),
    (re.compile(r"\bAPI\b"), "A P I"),
    (re.compile(r"\bUSB\b"), "U S B"),
    (re.compile(r"\bUART\b"), "U art"),
    (re.compile(r"\bGPIO\b"), "G P I O"),
    (re.compile(r"\bJTAG\b"), "J tag"),
    (re.compile(r"\bTTL\b"), "T T L"),
    (re.compile(r"\bCMOS\b"), "C moss"),
    (re.compile(r"\bLED\b"), "L E D"),
    (re.compile(r"\bLCD\b"), "L C D"),
    (re.compile(r"\bDr\.\b"), "Doctor"),
    (re.compile(r"\bPh\.D\.\b"), "P H D"),
    (re.compile(r"\bMr\.\b"), "Mister"),
    (re.compile(r"\bMrs\.\b"), "Misses"),
    (re.compile(r"\bFig\.\b"), "Figure"),
    (re.compile(r"\bEq\.\b"), "Equation"),
    (re.compile(r"\betc\.\b", re.IGNORECASE), "et cetera"),
    (re.compile(r"\be\.g\.\b", re.IGNORECASE), "for example"),
    (re.compile(r"\bi\.e\.\b", re.IGNORECASE), "that is"),
]

UNIT_REPLACEMENTS = [
    (re.compile(r"(\d+(?:\.\d+)?)\s*MHz\b", re.IGNORECASE), r"\1 megahertz"),
    (re.compile(r"(\d+(?:\.\d+)?)\s*GHz\b", re.IGNORECASE), r"\1 gigahertz"),
    (re.compile(r"(\d+(?:\.\d+)?)\s*kHz\b", re.IGNORECASE), r"\1 kilohertz"),
    (re.compile(r"(\d+(?:\.\d+)?)\s*KB\b", re.IGNORECASE), r"\1 kilobytes"),
    (re.compile(r"(\d+(?:\.\d+)?)\s*MB\b", re.IGNORECASE), r"\1 megabytes"),
    (re.compile(r"(\d+(?:\.\d+)?)\s*GB\b", re.IGNORECASE), r"\1 gigabytes"),
    (re.compile(r"(\d+(?:\.\d+)?)\s*V\b"), r"\1 volts"),
    (re.compile(r"(\d+(?:\.\d+)?)\s*mV\b"), r"\1 millivolts"),
    (re.compile(r"(\d+(?:\.\d+)?)\s*mA\b"), r"\1 milliamps"),
    (re.compile(r"(\d+(?:\.\d+)?)\s*ns\b", re.IGNORECASE), r"\1 nanoseconds"),
    (re.compile(r"(\d+(?:\.\d+)?)\s*ms\b", re.IGNORECASE), r"\1 milliseconds"),
]


def read_jsonl(path: Path) -> list[dict[str, Any]]:
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


def clean_text(value: str) -> str:
    value = value.replace("\u00ad", "")
    value = re.sub(r"-\s+", "", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def detect_language(text: str, title: str) -> str:
    sample = f"{text} {title}"
    latin = len(re.findall(r"[A-Za-z]", sample))
    cyrillic = len(re.findall(r"[А-Яа-яЁёІіЇїЄєҐґ]", sample))
    cjk = len(re.findall(r"[\u4e00-\u9fff]", sample))
    ukrainian = len(re.findall(r"[ІіЇїЄєҐґ]", sample))
    if cjk > 20 and cjk > max(latin, cyrillic) * 0.2:
        return "Chinese"
    if cyrillic > latin:
        return "Ukrainian" if ukrainian > 4 else "Russian"
    return "English"


def normalize_english(text: str) -> str:
    out = text
    for pattern, replacement in ABBREVIATION_REPLACEMENTS:
        out = pattern.sub(replacement, out)
    for pattern, replacement in UNIT_REPLACEMENTS:
        out = pattern.sub(replacement, out)
    return out


def normalize_for_tts(text: str, language: str) -> str:
    out = clean_text(text)
    out = re.sub(r"\s+([,.;:!?])", r"\1", out)
    out = out.replace("—", " — ")
    out = re.sub(r"\s+", " ", out).strip()
    if language == "English":
        out = normalize_english(out)
    return out


def looks_like_page_number(text: str) -> bool:
    stripped = text.strip()
    return bool(
        re.fullmatch(r"[-–—]?\s*(\d{1,4}|[ivxlcdmIVXLCDM]{1,8})\s*[-–—]?", stripped)
    )


def looks_like_service(text: str) -> bool:
    return any(pattern.search(text) for pattern in SERVICE_PATTERNS)


def looks_like_toc(text: str) -> bool:
    return any(pattern.search(text) for pattern in TOC_PATTERNS)


def looks_like_list(text: str) -> bool:
    return bool(re.match(r"^\s*(?:[-•*]|\d+[.)]|[a-zA-Z][.)])\s+", text))


def looks_like_heading(text: str) -> bool:
    if len(text) > 160:
        return False
    if looks_like_page_number(text) or looks_like_service(text):
        return False
    words = text.split()
    if not words:
        return False
    if re.match(
        r"^(chapter|part|section|appendix|contents|preface|introduction|glossary|index)\b",
        text,
        re.IGNORECASE,
    ):
        return True
    if re.match(
        r"^(глава|часть|раздел|введение|содержание|додаток|розділ)\b",
        text,
        re.IGNORECASE,
    ):
        return True
    alpha = re.sub(r"[^A-Za-zА-Яа-яЁёІіЇїЄєҐґ]", "", text)
    if len(alpha) >= 4 and alpha.upper() == alpha and len(words) <= 14:
        return True
    if len(words) <= 11 and not re.search(r"[.!?。！？:]$", text):
        title_like = sum(1 for word in words if word[:1].isupper())
        if title_like >= max(1, len(words) // 2):
            return True
    return False


def classify_block(
    block: dict[str, Any], index: int, total: int
) -> tuple[str, bool, int | None]:
    label = str(block.get("label", ""))
    text = clean_text(str(block.get("text", "")))
    label_l = label.lower()

    if "picture" in label_l or "figure" in label_l or "table" in label_l:
        return "figure", True, None
    if "caption" in label_l:
        return "caption", True, None
    if "sectionheader" in label_l or "title" in label_l:
        return "heading", True, 1 if index <= 2 else 2
    if "pagefooter" in label_l or "pageheader" in label_l:
        if looks_like_page_number(text):
            return "page-number", False, None
        return "header-footer", False, None
    if "footnote" in label_l:
        return "footnote", False, None
    if looks_like_page_number(text):
        return "page-number", False, None
    if looks_like_service(text):
        return "service", False, None
    if looks_like_toc(text):
        return "toc", False, None
    if looks_like_list(text):
        return "list", True, None
    if looks_like_heading(text):
        return "heading", True, 1 if index <= 2 else 2
    if index == 0 and total > 3 and len(text) <= 90:
        return "header-footer", False, None
    if (
        index == total - 1
        and total > 3
        and len(text) <= 90
        and not re.search(r"[.!?。！？]$", text)
    ):
        return "header-footer", False, None
    return "paragraph", True, None


def merge_text_blocks(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Keep the layout granularity by default. Only merge consecutive list items
    # from DataLab when they are very short, because the player can handle many
    # paragraph blocks and preserving ocrBlockIds is more useful for overlays.
    return blocks


def make_teacher_output(
    record: dict[str, Any], layout: dict[str, Any]
) -> dict[str, Any]:
    blocks_in = merge_text_blocks(layout.get("blocks", []))
    all_text = "\n".join(str(block.get("text", "")) for block in blocks_in)
    language = detect_language(all_text, record.get("documentTitle", ""))
    out_blocks: list[dict[str, Any]] = []

    for idx, raw_block in enumerate(blocks_in):
        raw_text = clean_text(str(raw_block.get("text", "")))
        block_type, is_main, level = classify_block(raw_block, idx, len(blocks_in))

        if block_type == "figure":
            text = (
                raw_text
                or "A figure, diagram, or table is present on the page. Review the page image for a precise spoken description."
            )
        else:
            text = normalize_for_tts(raw_text, language)

        if not text:
            continue

        block: dict[str, Any] = {
            "type": block_type,
            "text": text,
            "rawText": raw_text,
            "isFigure": block_type == "figure",
            "isMainContent": is_main,
            "ocrBlockIds": [raw_block["id"]],
        }
        if level is not None:
            block["level"] = level
        out_blocks.append(block)

    if not out_blocks:
        out_blocks.append(
            {
                "type": "unknown",
                "text": "This page has no readable narration content. Review the page image before synthesis.",
                "rawText": "",
                "isFigure": False,
                "isMainContent": False,
                "ocrBlockIds": [],
            }
        )

    return {"blocks": out_blocks, "pageLanguage": language}


def validate_teacher_output(record: dict[str, Any]) -> list[str]:
    output = record.get("teacherOutput")
    errors: list[str] = []
    if not isinstance(output, dict):
        return ["teacherOutput missing"]
    if not isinstance(output.get("pageLanguage"), str) or not output.get(
        "pageLanguage"
    ):
        errors.append("pageLanguage missing")
    blocks = output.get("blocks")
    if not isinstance(blocks, list):
        return errors + ["blocks is not list"]
    ocr_ids = {
        block.get("id")
        for block in record.get("ocrBlocks", [])
        if isinstance(block, dict)
    }
    for idx, block in enumerate(blocks):
        prefix = f"blocks[{idx}]"
        if block.get("type") not in BLOCK_TYPES:
            errors.append(f"{prefix}.type invalid")
        if not isinstance(block.get("text"), str) or not block.get("text"):
            errors.append(f"{prefix}.text empty")
        if not isinstance(block.get("isFigure"), bool):
            errors.append(f"{prefix}.isFigure invalid")
        if not isinstance(block.get("isMainContent"), bool):
            errors.append(f"{prefix}.isMainContent invalid")
        ids = block.get("ocrBlockIds")
        if not isinstance(ids, list) or not all(isinstance(v, str) for v in ids):
            errors.append(f"{prefix}.ocrBlockIds invalid")
        else:
            missing = [v for v in ids if v not in ocr_ids]
            if missing:
                errors.append(f"{prefix}.ocrBlockIds missing {missing[:3]}")
        if "level" in block and block.get("level") not in (1, 2):
            errors.append(f"{prefix}.level invalid")
    return errors


def convert_to_sft_messages(record: dict[str, Any]) -> dict[str, Any]:
    user_text = {
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
                "content": "You are an OCR + TTS-normalization assistant. Inspect the page image and OCR layout hints. Return strict JSON matching VlmPageResult: {blocks, pageLanguage}.",
            },
            {"role": "user", "content": json.dumps(user_text, ensure_ascii=False)},
            {
                "role": "assistant",
                "content": json.dumps(record["teacherOutput"], ensure_ascii=False),
            },
        ],
        "split": record.get("split", "train"),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=str(INPUT_QUEUE))
    parser.add_argument(
        "--output", default=str(ANNOTATIONS_DIR / "teacher_silver_300.jsonl")
    )
    args = parser.parse_args()

    records = read_jsonl(Path(args.input))
    annotated: list[dict[str, Any]] = []
    for record in records:
        layout_path_value = record.get("ocrLayoutPath")
        if not layout_path_value:
            annotated.append(record)
            continue
        layout_path = PROJECT_ROOT / layout_path_value
        layout = json.loads(layout_path.read_text(encoding="utf-8"))
        teacher_output = make_teacher_output(record, layout)
        out_record = dict(record)
        out_record["teacherOutput"] = teacher_output
        out_record["annotation"] = {
            **record.get("annotation", {}),
            "source": "silver-datalab-layout-plus-normalizer",
            "status": "silver_ready_needs_visual_gold_review",
            "notes": "Complete training target generated from DataLab layout/OCR and deterministic TTS normalization. Use PNG visual review for gold labels.",
        }
        errors = validate_teacher_output(out_record)
        out_record["annotation"]["validationErrors"] = errors
        annotated.append(out_record)

    output_path = Path(args.output)
    write_jsonl(output_path, annotated)
    write_jsonl(DATASET_DIR / "all_silver.jsonl", annotated)
    for split in ("train", "val", "test"):
        write_jsonl(
            DATASET_DIR / f"{split}_silver.jsonl",
            [r for r in annotated if r.get("split") == split],
        )

    sft = [
        convert_to_sft_messages(r)
        for r in annotated
        if isinstance(r.get("teacherOutput"), dict)
    ]
    write_jsonl(DATASET_DIR / "sft_silver.jsonl", sft)
    for split in ("train", "val", "test"):
        write_jsonl(
            DATASET_DIR / f"sft_{split}_silver.jsonl",
            [r for r in sft if r.get("split") == split],
        )

    block_counts = Counter()
    language_counts = Counter()
    validation_errors = 0
    ready = 0
    for record in annotated:
        output = record.get("teacherOutput")
        if not isinstance(output, dict):
            continue
        ready += 1
        language_counts[output.get("pageLanguage", "?")] += 1
        validation_errors += len(
            record.get("annotation", {}).get("validationErrors", [])
        )
        for block in output.get("blocks", []):
            block_counts[block.get("type", "?")] += 1

    stats = {
        "records": len(annotated),
        "readyTeacherOutputs": ready,
        "sftRecords": len(sft),
        "languages": dict(sorted(language_counts.items())),
        "blockTypes": dict(sorted(block_counts.items())),
        "totalBlocks": sum(block_counts.values()),
        "validationErrors": validation_errors,
        "source": "silver-datalab-layout-plus-normalizer",
    }
    (DATA_DIR / "silver_stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
