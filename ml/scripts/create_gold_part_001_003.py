#!/usr/bin/env python3
"""Create visually reviewed gold annotations for queue records 1-3."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SILVER = PROJECT_ROOT / "ml" / "data" / "annotations" / "teacher_silver_300.jsonl"
OUT = PROJECT_ROOT / "ml" / "data" / "annotations" / "gold_part_001_003.jsonl"


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records),
        encoding="utf-8",
    )


def with_gold(record: dict[str, Any], teacher_output: dict[str, Any]) -> dict[str, Any]:
    out = dict(record)
    out["teacherOutput"] = teacher_output
    out["annotation"] = {
        "source": "gpt-visual-teacher",
        "status": "gold_visual_reviewed",
        "visualReviewed": True,
        "schemaVersion": "vlm-block-schema-v1",
        "promptVersion": "document-to-tts-v1",
        "notes": "Reviewed from rendered PNG plus DataLab layout hints; PDF text layer was not used as target.",
    }
    return out


def main() -> None:
    records = read_jsonl(SILVER)
    by_id = {record["id"]: record for record in records}

    p1 = "digital-computer-electronics-albert-paul-malvino-and-jerald-a-brown_p0001"
    p2 = "digital-computer-electronics-albert-paul-malvino-and-jerald-a-brown_p0002"
    p3 = "digital-computer-electronics-albert-paul-malvino-and-jerald-a-brown_p0003"

    gold = [
        with_gold(
            by_id[p1],
            {
                "pageLanguage": "English",
                "blocks": [
                    {
                        "type": "heading",
                        "level": 1,
                        "text": "Digital Computer Electronics, Third Edition.",
                        "rawText": "Digital Computer Electronics Third Edition",
                        "isFigure": False,
                        "isMainContent": True,
                        "ocrBlockIds": [
                            f"ocr_{p1}_000",
                            f"ocr_{p1}_001",
                        ],
                    },
                    {
                        "type": "paragraph",
                        "text": "By Albert Paul Malvino, P H D, and Jerald A. Brown.",
                        "rawText": "Albert Paul Malvino, Ph.D. Jerald A. Brown",
                        "isFigure": False,
                        "isMainContent": True,
                        "ocrBlockIds": [
                            f"ocr_{p1}_002",
                            f"ocr_{p1}_003",
                        ],
                    },
                    {
                        "type": "figure",
                        "text": "The cover shows a stylized digital waveform diagram with several square pulses, suggesting digital logic signals over time.",
                        "rawText": "",
                        "isFigure": True,
                        "isMainContent": True,
                        "ocrBlockIds": [f"ocr_{p1}_004"],
                    },
                    {
                        "type": "service",
                        "text": "Glencoe, McGraw-Hill. New York, New York; Columbus, Ohio; Woodland Hills, California; Peoria, Illinois.",
                        "rawText": "GLENCOE McGraw-Hill New York, New York Columbus, Ohio Woodland Hills, California Peoria, Illinois",
                        "isFigure": False,
                        "isMainContent": False,
                        "ocrBlockIds": [
                            f"ocr_{p1}_005",
                            f"ocr_{p1}_006",
                            f"ocr_{p1}_007",
                        ],
                    },
                ],
            },
        ),
        with_gold(
            by_id[p2],
            {
                "pageLanguage": "English",
                "blocks": [
                    {
                        "type": "service",
                        "text": "This textbook was prepared with the assistance of Publishing Advisory Service.",
                        "rawText": "This textbook was prepared with the assistance of Publishing Advisory Service.",
                        "isFigure": False,
                        "isMainContent": False,
                        "ocrBlockIds": [f"ocr_{p2}_000"],
                    },
                    {
                        "type": "service",
                        "text": "L S I circuit photo: Manfred Kage, Peter Arnold Incorporated.",
                        "rawText": "LSI circuit photo: Manfred Kage/Peter Arnold Inc.",
                        "isFigure": False,
                        "isMainContent": False,
                        "ocrBlockIds": [f"ocr_{p2}_001"],
                    },
                    {
                        "type": "quote",
                        "text": "To my wife, Joanna, who encourages me to write. And to my daughters, Joanna, Antonia, Lucinda, Patricia, and Miriam, who keep me young. — A P M.",
                        "rawText": "To my wife, Joanna, who encourages me to write. And to my daughters, Joanna, Antonia, Lucinda, Patricia, and Miriam, who keep me young. —A.P.M.",
                        "isFigure": False,
                        "isMainContent": True,
                        "ocrBlockIds": [f"ocr_{p2}_002", f"ocr_{p2}_003"],
                    },
                    {
                        "type": "quote",
                        "text": "To my wife Vickie, dearest friend, fellow adventurer, love of my life. — J A B.",
                        "rawText": "... to my wife Vickie dearest friend fellow adventurer love of my life —J.A.B.",
                        "isFigure": False,
                        "isMainContent": True,
                        "ocrBlockIds": [f"ocr_{p2}_004", f"ocr_{p2}_005"],
                    },
                    {
                        "type": "service",
                        "text": "Library of Congress Cataloging-in-Publication Data. Malvino, Albert Paul. Digital computer electronics, Albert Paul Malvino, Jerald A. Brown, third edition. Includes index. I S B N 0-02-800594-5, hardcover. Electronic digital computers; microcomputers; Intel 8085 microprocessor. Cataloging and copyright data follows.",
                        "rawText": "Library of Congress Cataloging-in-Publication Data ... ISBN 0-02-800594-5 ... copyright data",
                        "isFigure": False,
                        "isMainContent": False,
                        "ocrBlockIds": [
                            f"ocr_{p2}_006",
                            f"ocr_{p2}_007",
                            f"ocr_{p2}_008",
                            f"ocr_{p2}_009",
                            f"ocr_{p2}_010",
                            f"ocr_{p2}_011",
                            f"ocr_{p2}_012",
                            f"ocr_{p2}_013",
                            f"ocr_{p2}_014",
                            f"ocr_{p2}_015",
                            f"ocr_{p2}_016",
                            f"ocr_{p2}_017",
                        ],
                    },
                    {
                        "type": "service",
                        "text": "Digital Computer Electronics, Third Edition. Imprint 1999. Copyright 1993 and 1983 by Glencoe McGraw-Hill. Printed in the United States of America. I S B N 0-02-800594-5.",
                        "rawText": "Digital Computer Electronics, Third Edition Imprint 1999 Copyright © 1993, 1983 by Glencoe/McGraw-Hill ... ISBN 0-02-800594-5 Printed in the United States of America.",
                        "isFigure": False,
                        "isMainContent": False,
                        "ocrBlockIds": [
                            f"ocr_{p2}_018",
                            f"ocr_{p2}_019",
                            f"ocr_{p2}_020",
                            f"ocr_{p2}_021",
                            f"ocr_{p2}_022",
                            f"ocr_{p2}_023",
                        ],
                    },
                ],
            },
        ),
        with_gold(
            by_id[p3],
            {
                "pageLanguage": "English",
                "blocks": [
                    {
                        "type": "toc",
                        "text": "Contents.",
                        "rawText": "Contents",
                        "isFigure": False,
                        "isMainContent": False,
                        "ocrBlockIds": [f"ocr_{p3}_000"],
                    },
                    {
                        "type": "toc",
                        "text": "Preface, page six.",
                        "rawText": "PREFACE vi",
                        "isFigure": False,
                        "isMainContent": False,
                        "ocrBlockIds": [f"ocr_{p3}_001"],
                    },
                    {
                        "type": "toc",
                        "text": "Part One, Digital Principles, page one. Chapters include Number Systems and Codes; Gates; More Logic Gates; T T L Circuits; Boolean Algebra and Karnaugh Maps; Arithmetic-Logic Units; Flip-Flops; Registers and Counters; and Memories.",
                        "rawText": "PART 1 Digital Principles 1; chapters 1 through 9",
                        "isFigure": False,
                        "isMainContent": False,
                        "ocrBlockIds": [
                            f"ocr_{p3}_002",
                            f"ocr_{p3}_003",
                            f"ocr_{p3}_004",
                            f"ocr_{p3}_005",
                            f"ocr_{p3}_006",
                            f"ocr_{p3}_007",
                            f"ocr_{p3}_008",
                            f"ocr_{p3}_009",
                            f"ocr_{p3}_010",
                            f"ocr_{p3}_011",
                            f"ocr_{p3}_012",
                            f"ocr_{p3}_013",
                            f"ocr_{p3}_014",
                            f"ocr_{p3}_015",
                            f"ocr_{p3}_016",
                            f"ocr_{p3}_017",
                            f"ocr_{p3}_018",
                            f"ocr_{p3}_019",
                        ],
                    },
                    {
                        "type": "toc",
                        "text": "Part Two, S A P, Simple-as-Possible Computers, page one hundred forty. Chapters include S A P One and S A P Two.",
                        "rawText": "PART 2 SAP (Simple-as-Possible) Computers 140; CHAPTER 10 SAP-1 140; CHAPTER 11 SAP-2 173",
                        "isFigure": False,
                        "isMainContent": False,
                        "ocrBlockIds": [
                            f"ocr_{p3}_020",
                            f"ocr_{p3}_021",
                            f"ocr_{p3}_022",
                            f"ocr_{p3}_023",
                            f"ocr_{p3}_024",
                            f"ocr_{p3}_025",
                            f"ocr_{p3}_026",
                            f"ocr_{p3}_027",
                        ],
                    },
                    {
                        "type": "page-number",
                        "text": "three",
                        "rawText": "iii",
                        "isFigure": False,
                        "isMainContent": False,
                        "ocrBlockIds": [f"ocr_{p3}_028"],
                    },
                ],
            },
        ),
    ]

    write_jsonl(OUT, gold)
    print(f"wrote {len(gold)} records to {OUT.relative_to(PROJECT_ROOT)}")


if __name__ == "__main__":
    main()
