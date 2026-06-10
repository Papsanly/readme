#!/usr/bin/env python3
"""Create visually reviewed gold annotations for queue records 4-20."""

from __future__ import annotations

import json
import re
from copy import deepcopy
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
QUEUE = PROJECT_ROOT / "ml" / "data" / "visual_queue_with_datalab.jsonl"
ANNOTATIONS = PROJECT_ROOT / "ml" / "data" / "annotations"
OUT = ANNOTATIONS / "gold_part_004_020.jsonl"
EXISTING_GOLD = [
    ANNOTATIONS / "gold_part_004_008.jsonl",
    ANNOTATIONS / "gold_part_009_013.jsonl",
]

START = 4
END = 20

ANNOTATION = {
    "source": "gpt-visual-teacher",
    "status": "gold_visual_reviewed",
    "visualReviewed": True,
    "schemaVersion": "vlm-block-schema-v1",
    "promptVersion": "document-to-tts-v1",
}

FOOTERS: dict[str, tuple[str, str, str]] = {
    "digital-computer-electronics-albert-paul-malvino-and-jerald-a-brown_p0019": (
        "header-footer",
        "Chapter 1, Number Systems and Codes, page thirteen.",
        "Chapter 1 Number Systems and Codes 13",
    ),
    "digital-computer-electronics-albert-paul-malvino-and-jerald-a-brown_p0022": (
        "header-footer",
        "Digital Computer Electronics, page sixteen.",
        "16 Digital Computer Electronics",
    ),
    "digital-computer-electronics-albert-paul-malvino-and-jerald-a-brown_p0026": (
        "header-footer",
        "Digital Computer Electronics, page twenty.",
        "20 Digital Computer Electronics",
    ),
    "digital-computer-electronics-albert-paul-malvino-and-jerald-a-brown_p0029": (
        "header-footer",
        "Chapter 2, Gates, page twenty-three.",
        "Chapter 2 Gates 23",
    ),
    "digital-computer-electronics-albert-paul-malvino-and-jerald-a-brown_p0033": (
        "header-footer",
        "Chapter 2, Gates, page twenty-seven.",
        "Chapter 2 Gates 27",
    ),
    "digital-computer-electronics-albert-paul-malvino-and-jerald-a-brown_p0037": (
        "header-footer",
        "Chapter 2, Gates, page thirty-one.",
        "Chapter 2 Gates 31",
    ),
    "digital-computer-electronics-albert-paul-malvino-and-jerald-a-brown_p0040": (
        "header-footer",
        "Digital Computer Electronics, page thirty-four.",
        "34 Digital Computer Electronics",
    ),
}

EQUATION_TEXT: dict[tuple[str, int], str] = {
    ("p0019", 4): "Hexadecimal 7 E converts to decimal 126.",
    (
        "p0019",
        9,
    ): "2,479 divided by 16 gives quotient 154 and remainder 15, which is hexadecimal F.",
    (
        "p0019",
        11,
    ): "154 divided by 16 gives quotient 9 and remainder 10, which is hexadecimal A; the earlier remainder is hexadecimal F.",
    (
        "p0019",
        13,
    ): "The final division gives quotient 0 and remainder 9. Reading the remainders downward gives hexadecimal 9 A F.",
    ("p0019", 20): "Decimal 141 converts to hexadecimal 8 D.",
    ("p0019", 25): "U B decimal equals 35,840.",
    ("p0019", 27): "35,840 converts to hexadecimal 8 C.",
    ("p0019", 30): "36,020 minus 35,840 equals 180.",
    ("p0019", 32): "180 converts to hexadecimal B 4.",
    ("p0022", 5): "2 plus 2 equals 4.",
    ("p0022", 11): "x base ten equals one one zero zero one zero zero one base two.",
    ("p0029", 8): "2 to the n equals 2 to the eighth equals 256.",
    ("p0029", 17): "Enable equals 0.",
    (
        "p0029",
        19,
    ): "Y five, Y four, Y three, Y two, Y one, Y zero equals zero zero zero zero zero zero.",
    ("p0029", 22): "Enable equals 1.",
    (
        "p0029",
        24,
    ): "Y five, Y four, Y three, Y two, Y one, Y zero equals one zero zero one zero zero.",
    ("p0029", 26): "Y five, Y four, Y three, Y two, Y one, Y zero equals A B C D E F.",
    ("p0029", 34): "Y equals NOT A. Equation 2-1.",
    ("p0033", 7): "Y zero equals not A times not B times not C times not D.",
    ("p0033", 9): "Y one equals not A times not B times not C times D.",
    ("p0033", 11): "Y two equals not A times not B times C times not D.",
    ("p0033", 12): "Y three equals not A times not B times C times D.",
    ("p0033", 13): "Y four equals not A times B times not C times not D.",
    ("p0033", 14): "Y five equals not A times B times not C times D.",
    ("p0033", 15): "Y six equals not A times B times C times not D.",
    ("p0033", 16): "Y seven equals not A times B times C times D.",
    ("p0033", 17): "Y eight equals A times not B times not C times not D.",
    ("p0033", 18): "Y nine equals A times not B times not C times D.",
    ("p0037", 2): "Op code equals I fifteen, I fourteen, I thirteen, I twelve.",
    (
        "p0040",
        8,
    ): "The complement of A plus B plus C equals not A times not B times not C. Equation 3-5.",
    (
        "p0040",
        10,
    ): "The complement of A plus B plus C plus D equals not A times not B times not C times not D. Equation 3-6.",
}

FIGURE_TEXT: dict[tuple[str, int], str] = {
    (
        "p0022",
        8,
    ): "Figure 1-8 shows an 8-bit L E D display with circles in this visual order: light, dark, light, dark, light, light, dark, dark. With light meaning binary one and dark meaning binary zero, the displayed binary pattern is one zero one zero one one zero zero.",
    (
        "p0026",
        26,
    ): "Table 2-3 is the truth table for a two-input OR gate. Inputs A B of 00 give Y 0; 01 gives Y 1; 10 gives Y 1; and 11 gives Y 1.",
    (
        "p0026",
        28,
    ): "Table 2-4 is the truth table for a three-input OR gate. Only input word 000 gives output 0; every input word with one or more ones gives output 1.",
}

RAW_TEXT_OVERRIDE: dict[tuple[str, int], str] = {
    (
        "p0022",
        8,
    ): "Eight LED circles: light, dark, light, dark, light, light, dark, dark.",
}


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records),
        encoding="utf-8",
    )


def queue_records() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    with QUEUE.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            if START <= line_no <= END:
                out.append(json.loads(line))
    return out


def suffix(record_id: str) -> str:
    return record_id.rsplit("_", 1)[-1]


def binary_to_words(match: re.Match[str]) -> str:
    value = match.group(0)
    compact = value.replace(" ", "")
    if len(compact) < 3:
        return value
    return " ".join("zero" if ch == "0" else "one" for ch in compact)


def normalize_common(text: str) -> str:
    t = text.replace("\n", " ")
    t = re.sub(r"\s+", " ", t).strip()
    t = t.replace("Fig.", "Figure")
    t = t.replace("2^{10}", "2 to the tenth").replace("2^10", "2 to the tenth")
    t = t.replace(" .", ".").replace(" ,", ",").replace(" ;", ";").replace(" :", ":")
    replacements = [
        ("Ph.D.", "P H D"),
        ("MS-DOS", "M S D O S"),
        ("DOS DEBUG", "D O S DEBUG"),
        ("I/O", "input/output"),
        ("CPU", "C P U"),
        ("BCD", "B C D"),
        ("ASCII", "A S C I I"),
        ("TTL", "T T L"),
        ("LEDs", "L E D's"),
        ("LED", "L E D"),
        ("ICs", "I C's"),
        ("IC", "I C"),
        ("MOS", "M O S"),
        ("SAP", "S A P"),
        ("MOV", "M O V"),
        ("MVI", "M V I"),
        ("EOR", "E O R"),
        ("XOR", "X O R"),
        ("LDA", "L D A"),
        ("SUB", "S U B"),
        ("UB", "U B"),
        ("LB", "L B"),
        ("OP CODE", "op code"),
    ]
    for old, new in replacements:
        t = re.sub(rf"\b{re.escape(old)}\b", new, t)
    t = re.sub(r"\bADD\b", "A D D", t)
    t = re.sub(r"\bZ80\b", "Z eighty", t)
    t = re.sub(r"\b([0-9]+)K\b", r"\1 K", t)
    t = re.sub(r"\b([0-9]+)\s*V\b", r"\1 volts", t)
    t = t.replace("\\text{ V}", "volts")
    t = t.replace("\\text{V}", "volts")
    t = t.replace("\\text", "")
    t = t.replace("{", "").replace("}", "")
    t = re.sub(r"_{2,}", " blank ", t)
    t = t.replace("_", " ")
    t = t.replace("\\", "")
    t = re.sub(r"(?<![0-9])-5\s*volts", "minus 5 volts", t)
    t = re.sub(r"(?<![0-9])\+5\s*volts", "plus 5 volts", t)
    t = re.sub(r"\b0s\b", "zeros", t)
    t = re.sub(r"\b1s\b", "ones", t)
    t = re.sub(
        r"(?<![A-Za-z0-9])(?:[01]{3,}(?:\s+[01]{3,})*)(?![A-Za-z0-9])",
        binary_to_words,
        t,
    )
    t = re.sub(r"\s+", " ", t).strip()
    return t


def normalize_heading(text: str) -> str:
    raw = text.strip()
    if raw == "SOLUTION":
        return "Solution."
    m = re.match(r"EXAMPLE\s+(.*)", raw)
    if m:
        return f"Example {m.group(1)}."
    if raw in {"SELF-TESTING REVIEW", "PROBLEMS", "GLOSSARY"}:
        return raw.title().replace("Self-Testing", "Self-testing") + "."
    m = re.match(r"^(\d+-\d+)\s+(.+)$", raw)
    if m:
        return f"{m.group(1)}. {normalize_common(m.group(2)).title()}."
    return normalize_common(raw)


def heading_level(text: str) -> int:
    raw = text.strip()
    if re.match(r"^\d+-\d+\s+", raw) or raw in {
        "SELF-TESTING REVIEW",
        "PROBLEMS",
        "GLOSSARY",
    }:
        return 1
    return 2


def block(
    kind: str,
    text: str,
    raw_text: str,
    ocr_ids: list[str],
    *,
    is_figure: bool = False,
    is_main: bool = True,
    level: int | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "type": kind,
        "text": text,
        "rawText": raw_text,
        "isFigure": is_figure,
        "isMainContent": is_main,
        "ocrBlockIds": ocr_ids,
    }
    if level is not None:
        out["level"] = level
    return out


def auto_teacher(record: dict[str, Any]) -> dict[str, Any]:
    rid = record["id"]
    suf = suffix(rid)
    blocks: list[dict[str, Any]] = []
    for idx, ocr_block in enumerate(record.get("ocrBlocks", [])):
        label = ocr_block.get("label", "Text")
        raw = ocr_block.get("text", "")
        oid = ocr_block["id"]
        key = (suf, idx)
        raw_out = RAW_TEXT_OVERRIDE.get(key, raw)

        if label == "PageFooter":
            kind, text, footer_raw = FOOTERS[rid]
            blocks.append(block(kind, text, footer_raw, [oid], is_main=False))
        elif label == "SectionHeader":
            blocks.append(
                block(
                    "heading",
                    normalize_heading(raw),
                    raw,
                    [oid],
                    level=heading_level(raw),
                )
            )
        elif label == "ListGroup":
            blocks.append(block("list", normalize_common(raw), raw, [oid]))
        elif label == "Caption":
            blocks.append(
                block(
                    "caption",
                    normalize_common(raw.replace("Fig.", "Figure")),
                    raw,
                    [oid],
                )
            )
        elif label in {"Figure", "Picture", "Table"}:
            text = FIGURE_TEXT.get(key, normalize_common(raw))
            blocks.append(block("figure", text, raw_out, [oid], is_figure=True))
        elif label == "Equation":
            text = EQUATION_TEXT.get(key, normalize_common(raw))
            blocks.append(block("paragraph", text, raw, [oid]))
        else:
            blocks.append(block("paragraph", normalize_common(raw), raw, [oid]))
    return {"pageLanguage": "English", "blocks": blocks}


def copy_existing_outputs() -> dict[str, dict[str, Any]]:
    outputs: dict[str, dict[str, Any]] = {}
    for path in EXISTING_GOLD:
        for rec in read_jsonl(path):
            outputs[rec["id"]] = deepcopy(rec["teacherOutput"])
    return outputs


def mark_front_matter_service(teacher_output: dict[str, Any]) -> dict[str, Any]:
    out = deepcopy(teacher_output)
    for b in out.get("blocks", []):
        if b.get("type") != "page-number":
            b["type"] = "service"
            b["isMainContent"] = False
            b.pop("level", None)
    return out


def main() -> None:
    selected = queue_records()
    existing_outputs = copy_existing_outputs()
    records: list[dict[str, Any]] = []
    for rec in selected:
        rid = rec["id"]
        out = deepcopy(rec)
        if rid in existing_outputs:
            teacher_output = existing_outputs[rid]
        else:
            teacher_output = auto_teacher(rec)
        if rid.endswith("_p0006"):
            teacher_output = mark_front_matter_service(teacher_output)
        out["teacherOutput"] = teacher_output
        out["annotation"] = deepcopy(ANNOTATION)
        records.append(out)

    write_jsonl(OUT, records)
    print(
        json.dumps(
            {"output": str(OUT.relative_to(PROJECT_ROOT)), "records": len(records)},
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
