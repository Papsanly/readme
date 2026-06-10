#!/usr/bin/env python3
"""Create visually reviewed gold annotations for queue records 4-8."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SILVER = PROJECT_ROOT / "ml" / "data" / "annotations" / "teacher_silver_300.jsonl"
OUT = PROJECT_ROOT / "ml" / "data" / "annotations" / "gold_part_004_008.jsonl"


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


def ocr(page_id: str, *nums: int) -> list[str]:
    return [f"ocr_{page_id}_{num:03d}" for num in nums]


def block(
    kind: str,
    text: str,
    raw_text: str,
    ocr_block_ids: Iterable[str],
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
        "ocrBlockIds": list(ocr_block_ids),
    }
    if level is not None:
        out["level"] = level
    return out


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

    p4 = "digital-computer-electronics-albert-paul-malvino-and-jerald-a-brown_p0004"
    p5 = "digital-computer-electronics-albert-paul-malvino-and-jerald-a-brown_p0005"
    p6 = "digital-computer-electronics-albert-paul-malvino-and-jerald-a-brown_p0006"
    p7 = "digital-computer-electronics-albert-paul-malvino-and-jerald-a-brown_p0007"
    p8 = "digital-computer-electronics-albert-paul-malvino-and-jerald-a-brown_p0008"

    gold = [
        with_gold(
            by_id[p4],
            {
                "pageLanguage": "English",
                "blocks": [
                    block(
                        "toc",
                        "Chapter twelve, S A P Three, page one hundred ninety-five. Sections: twelve-one, Programming Model; twelve-two, M O V and M V I; twelve-three, Arithmetic Instructions; twelve-four, Increments, Decrements, and Rotates; twelve-five, Logic Instructions; twelve-six, Arithmetic and Logic Immediates; twelve-seven, Jump Instructions; twelve-eight, Extended-Register Instructions; twelve-nine, Indirect Instructions; and twelve-ten, Stack Instructions.",
                        "CHAPTER 12. SAP-3 195\n12-1. Programming Model 12-2. MOV and MVI 12-3. Arithmetic Instructions 12-4. Increments, Decrements, and Rotates 12-5. Logic Instructions 12-6. Arithmetic and Logic Immediates 12-7. Jump Instructions 12-8. Extended-Register Instructions 12-9. Indirect Instructions 12-10. Stack Instructions",
                        ocr(p4, 0, 1),
                        is_main=False,
                    ),
                    block(
                        "toc",
                        "Part Three, Programming Popular Microprocessors, page two hundred thirteen. Chapter thirteen, Introduction to Microprocessors, page two hundred thirteen: Computer Hardware; Definition of a Microprocessor; Some Common Uses for Microprocessors; Microprocessors Featured in This Text; and Access to Microprocessors. Chapter fourteen, Programming and Languages, page two hundred sixteen: Relationship between Electronics and Programming; Programming; Fundamental Premise; Flowcharts; Programming Languages; Assembly Language; and Worksheets. Chapter fifteen, System Overview, page two hundred twenty-four: New Concepts, including Computer Architecture and Microprocessor Architecture; then Specific Microprocessor Families, including the 6502 family, 6800/6808 family, 8080/8085/Z80 family, and 8086/8088 family. Chapter sixteen, Data Transfer Instructions, page two hundred forty: New Concepts, including C P U Control Instructions and Data Transfer Instructions; then Specific Microprocessor Families, including the 6502 family, 6800/6808 family, 8080/8085/Z80 family, and 8086/8088 family. Chapter seventeen, Addressing Modes One, page two hundred sixty-three: New Concepts, including What Is an Addressing Mode, the Paging Concept, and Basic Addressing Modes; then Specific Microprocessor Families, including the 6502 family, 6800/6808 family, 8080/8085/Z80 family, and 8086/8088 family.",
                        "PART 3\nProgramming Popular Microprocessors 213\nCHAPTER 13. INTRODUCTION TO MICROPROCESSORS 213\n13-1. Computer Hardware 13-2. Definition of a Microprocessor 13-3. Some Common Uses for Microprocessors 13-4. Microprocessors Featured in This Text 13-5. Access to Microprocessors\nCHAPTER 14. PROGRAMMING AND LANGUAGES 216\n14-1. Relationship between Electronics and Programming 14-2. Programming 14-3. Fundamental Premise 14-4. Flowcharts 14-5. Programming Languages 14-6. Assembly Language 14-7. Worksheets\nCHAPTER 15. SYSTEM OVERVIEW 224\nNew Concepts 15-1. Computer Architecture 15-2. Microprocessor Architecture Specific Microprocessor Families 15-3. 6502 Family 15-4. 6800/6808 Family 15-5. 8080/8085/Z80 Family 15-6. 8086/8088 Family\nCHAPTER 16. DATA TRANSFER INSTRUCTIONS 240\nNew Concepts 16-1. CPU Control Instructions 16-2. Data Transfer Instructions Specific Microprocessor Families 16-3. 6502 Family 16-4. 6800/6808 Family 16-5. 8080/8085/Z80 Family 16-6. 8086/8088 Family\nCHAPTER 17. ADDRESSING MODES—I 263\nNew Concepts 17-1. What Is an Addressing Mode? 17-2. The Paging Concept 17-3. Basic Addressing Modes Specific Microprocessor Families 17-4. 6502 Family 17-5. 6800/6808 Family 17-6. 8080/8085/Z80 Family 17-7. 8086/8088 Family",
                        ocr(p4, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13),
                        is_main=False,
                    ),
                    block(
                        "toc",
                        "Chapter eighteen, Arithmetic and Flags, page two hundred seventy: New Concepts, including Microprocessors and Numbers, Arithmetic Instructions, and Flag Instructions; then Specific Microprocessor Families, including the 6502 family, 6800/6808 family, 8080/8085/Z80 family, and 8086/8088 family. Chapter nineteen, Logical Instructions, page three hundred five: New Concepts, including the AND Instruction, the OR Instruction, the Exclusive-OR, E O R, X O R Instruction, the NOT Instruction, and the NEG, Negate, Instruction; then Specific Microprocessor Families, including the 6502 family, 6800/6808 family, 8080/8085/Z80 family, and 8086/8088 family. Chapter twenty, Shift and Rotate Instructions, page three hundred nineteen: New Concepts, including Rotating, Shifting, and An Example; then Specific Microprocessor Families, including the 6502 family, 6800/6808 family, 8080/8085/Z80 family, and 8086/8088 family. Chapter twenty-one, Addressing Modes Two, page three hundred twenty-nine: New Concepts, including Advanced Addressing Modes; then Specific Microprocessor Families, including the 6502 family, 6800/6808 family, 8080/8085/Z80 family, and 8086/8088 family. Chapter twenty-two, Branching and Loops, page three hundred forty-two: New Concepts, including Unconditional Jumps, Conditional Branching, Compare and Test Instructions, Increment and Decrement Instructions, and Nested Loops; then Specific Microprocessor Families, including the 6502 family, 6800/6808 family, 8080/8085/Z80 family, and 8086/8088 family. Chapter twenty-three, Subroutine and Stack Instructions, page three hundred sixty-three: New Concepts, including Stack and Stack Pointer, Branching versus Subroutines, How Do Subroutines Return, and Pushing and Popping Registers; then Specific Microprocessor Families, including the 6502 family, 6800/6808 family, 8080/8085/Z80 family, and 8086/8088 family.",
                        "CHAPTER 18. ARITHMETIC AND FLAGS 270\nNew Concepts 18-1. Microprocessors and Numbers 18-2. Arithmetic Instructions 18-3. Flag Instructions Specific Microprocessor Families 18-4. 6502 Family 18-5. 6800/6808 Family 18-6. 8080/8085/Z80 Family 18-7. 8086/8088 Family\nCHAPTER 19. LOGICAL INSTRUCTIONS 305\nNew Concepts 19-1. The AND Instruction 19-2. The OR Instruction 19-3. The EXCLUSIVE-OR (EOR, XOR) Instruction 19-4. The NOT Instruction 19-5. The NEG (NEGate) Instruction Specific Microprocessor Families 19-6. 6502 Family 19-7. 6800/6808 Family 19-8. 8080/8085/Z80 Family 19-9. 8086/8088 Family\nCHAPTER 20. SHIFT AND ROTATE INSTRUCTIONS 319\nNew Concepts 20-1. Rotating 20-2. Shifting 20-3. An Example Specific Microprocessor Families 20-4. 6502 Family 20-5. 6800/6808 Family 20-6. 8080/8085/Z80 Family 20-7. 8086/8088 Family\nCHAPTER 21. ADDRESSING MODES—II 329\nNew Concepts 21-1. Advanced Addressing Modes Specific Microprocessor Families 21-2. 6502 Family 21-3. 6800/6808 Family 21-4. 8080/8085/Z80 Family 21-5. 8086/8088 Family\nCHAPTER 22. BRANCHING AND LOOPS 342\nNew Concepts 22-1. Unconditional Jumps 22-2. Conditional Branching 22-3. Compare and Test Instructions 22-4. Increment and Decrement Instructions 22-5. Nested Loops Specific Microprocessor Families 22-6. 6502 Family 22-7. 6800/6808 Family 22-8. 8080/8085/Z80 Family 22-9. 8086/8088 Family\nCHAPTER 23. SUBROUTINE AND STACK INSTRUCTIONS 363\nNew Concepts 23-1. Stack and Stack Pointer 23-2. Branching versus Subroutines 23-3. How Do Subroutines Return? 23-4. Pushing and Popping Registers Specific Microprocessor Families 23-5. 6502 Family 23-6. 6800/6808 Family 23-7. 8080/8085/Z80 Family 23-8. 8086/8088 Family",
                        ocr(p4, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25),
                        is_main=False,
                    ),
                    block(
                        "header-footer",
                        "Contents, page four.",
                        "iv Contents",
                        ocr(p4, 26),
                        is_main=False,
                    ),
                ],
            },
        ),
        with_gold(
            by_id[p5],
            {
                "pageLanguage": "English",
                "blocks": [
                    block(
                        "toc",
                        "Part Four, Microprocessor Instruction Set Tables, page three hundred seventy-nine. Section A: expanded table of 8085/8080 and Z80, 8080 subset, instructions listed by category, page three hundred eighty-one; mini table of 8085/8080 and Z80, 8080 subset, instructions listed by category, page four hundred ten; condensed table of 8085/8080 and Z80, 8080 instructions listed by category, page four hundred fifteen; condensed table of 8085/8080 and Z80, 8080 subset, instructions listed by op code, page four hundred seventeen; condensed table of 8085/8080 and Z80, 8080 subset, instructions listed alphabetically by 8085/8080 mnemonic, page four hundred nineteen; and condensed table of 8085/8080 and Z80, 8080 subset, instructions listed alphabetically by Z80 mnemonic, page four hundred twenty-one.",
                        "PART 4\nMicroprocessor Instruction Set Tables 379\nA.\nExpanded Table of 8085/8080 and Z80 (8080 Subset) Instructions Listed by Category 381\nMini Table of 8085/8080 and Z80 (8080 Subset) Instructions Listed by Category 410\nCondensed Table of 8085/8080 and Z80 (8080) Instructions Listed by Category 415\nCondensed Table of 8085/8080 and Z80 (8080 Subset) Instructions Listed by Op Code 417\nCondensed Table of 8085/8080 and Z80 (8080 Subset) Instructions Listed Alphabetically by 8085/8080 Mnemonic 419\nCondensed Table of 8085/8080 and Z80 (8080 Subset) Instructions Listed Alphabetically by Z80 Mnemonic 421",
                        ocr(p5, 0, 1, 2, 3, 4, 5, 6, 7, 8),
                        is_main=False,
                    ),
                    block(
                        "toc",
                        "Section B: expanded table of 6800 instructions listed by category, page four hundred twenty-two; short table of 6800 instructions listed alphabetically, page four hundred thirty-four; short table of 6800 instructions listed by category, page four hundred thirty-seven; condensed table of 6800 instructions listed by category, page four hundred forty-one; condensed table of 6800 instructions listed alphabetically, page four hundred forty-three; and condensed table of 6800 instructions listed by op code, page four hundred forty-four.",
                        "B.\nExpanded Table of 6800 Instructions Listed by Category 422\nShort Table of 6800 Instructions Listed Alphabetically 434\nShort Table of 6800 Instructions Listed by Category 437\nCondensed Table of 6800 Instructions Listed by Category 441\nCondensed Table of 6800 Instructions Listed Alphabetically 443\nCondensed Table of 6800 Instructions Listed by Op Code 444",
                        ocr(p5, 9, 10, 11, 12, 13, 14, 15),
                        is_main=False,
                    ),
                    block(
                        "toc",
                        "Section C: expanded table of 8086/8088 instructions listed by category, page four hundred forty-five; condensed table of 8086/8088 instructions listed by category, page four hundred sixty-five; and condensed table of 8086/8088 instructions listed alphabetically, page four hundred sixty-nine. Section D: expanded table of 6502 instructions listed by category, page four hundred seventy-one; short table of 6502 instructions listed by category, page four hundred seventy-eight; condensed table of 6502 instructions listed by category, page four hundred eighty; condensed table of 6502 instructions listed alphabetically, page four hundred eighty-one; and condensed table of 6502 instructions listed by op code, page four hundred eighty-two.",
                        "C.\nExpanded Table of 8086/8088 Instructions Listed by Category 445\nCondensed Table of 8086/8088 Instructions Listed by Category 465\nCondensed Table of 8086/8088 Instructions Listed Alphabetically 469\nD.\nExpanded Table of 6502 Instructions Listed by Category 471\nShort Table of 6502 Instructions Listed by Category 478\nCondensed Table of 6502 Instructions Listed by Category 480\nCondensed Table of 6502 Instructions Listed Alphabetically 481\nCondensed Table of 6502 Instructions Listed by Op Code 482",
                        ocr(p5, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25),
                        is_main=False,
                    ),
                    block(
                        "toc",
                        "Appendixes, page four hundred eighty-five. Appendix one, The Analog Interface. Appendix two, Binary-Hexadecimal-Decimal Equivalents. Appendix three, 7400 Series T T L. Appendix four, Pinouts and Function Tables. Appendix five, S A P One Parts List. Appendix six, 8085 Instructions. Appendix seven, Memory Locations: Powers of Two. Appendix eight, Memory Locations: 16 K and 8 K Intervals. Appendix nine, Memory Locations: 4 K Intervals. Appendix ten, Memory Locations: 2 K Intervals. Appendix eleven, Memory Locations: 1 K Intervals. Appendix twelve, Programming Models.",
                        "APPENDIXES 485\n1. The Analog Interface 2. Binary-Hexadecimal-Decimal Equivalents 3. 7400 Series TTL 4. Pinouts and Function Tables 5. SAP-1 Parts List 6. 8085 Instructions 7. Memory Locations: Powers of 2 8. Memory Locations: 16K and 8K Intervals 9. Memory Locations: 4K Intervals 10. Memory Locations: 2K Intervals 11. Memory Locations: 1K Intervals 12. Programming Models",
                        ocr(p5, 26, 27),
                        is_main=False,
                    ),
                    block(
                        "toc",
                        "Answers to odd-numbered problems, page five hundred thirteen. Index, page five hundred nineteen.",
                        "ANSWERS TO ODD-NUMBERED PROBLEMS 513\nINDEX 519",
                        ocr(p5, 28, 29),
                        is_main=False,
                    ),
                    block(
                        "header-footer",
                        "Contents, page five.",
                        "Contents v",
                        ocr(p5, 30),
                        is_main=False,
                    ),
                ],
            },
        ),
        with_gold(
            by_id[p6],
            {
                "pageLanguage": "English",
                "blocks": [
                    block("heading", "Preface", "Preface", ocr(p6, 0), level=1),
                    block(
                        "paragraph",
                        "Textbooks on microprocessors are sometimes hard to understand. This text attempts to present the various aspects of microprocessors in ways that are understandable and interesting. The only prerequisite to using this textbook is an understanding of diodes and transistors.",
                        "Textbooks on microprocessors are sometimes hard to understand. This text attempts to present the various aspects of microprocessors in ways that are understandable and interesting. The only prerequisite to using this textbook is an understanding of diodes and transistors.",
                        ocr(p6, 1),
                    ),
                    block(
                        "paragraph",
                        "A unique aspect of this text is its wide range. Whether you are interested in the student-constructed S A P, simple-as-possible, microprocessor, the 6502, the 6800/6808, the 8080/8085/Z80, or the 8086/8088, this textbook can meet your needs.",
                        "A unique aspect of this text is its wide range. Whether you are interested in the student-constructed SAP (simple-as-possible) microprocessor, the 6502, the 6800/6808, the 8080/8085/Z80, or the 8086/8088, this textbook can meet your needs.",
                        ocr(p6, 2),
                    ),
                    block(
                        "paragraph",
                        "The text is divided into four parts. These parts can be used in different ways to meet the needs of a wide variety of students, classrooms, and instructors.",
                        "The text is divided into four parts. These parts can be used in different ways to meet the needs of a wide variety of students, classrooms, and instructors.",
                        ocr(p6, 3),
                    ),
                    block(
                        "paragraph",
                        "Part One, Digital Principles, is composed of Chapters 1 to 9. Featured topics include number systems, gates, boolean algebra, flip-flops, registers, counters, and memory. This information prepares the student for the microprocessor sections which follow.",
                        "Part 1, Digital Principles, is composed of Chapters 1 to 9. Featured topics include number systems, gates, boolean algebra, flip-flops, registers, counters, and memory. This information prepares the student for the microprocessor sections which follow.",
                        ocr(p6, 4),
                    ),
                    block(
                        "paragraph",
                        "Part Two, which consists of Chapters 10 to 12, presents the S A P, simple-as-possible, microprocessor. The student constructs this processor using digital components. The S A P processor contains the most common microprocessor functions. It features an instruction set which is a subset of that of the Intel 8085, leading naturally to a study of that microprocessor.",
                        "Part 2, which consists of Chapters 10 to 12, presents the SAP (simple-as-possible) microprocessor. The student constructs this processor using digital components. The SAP processor contains the most common microprocessor functions. It features an instruction set which is a subset of that of the Intel 8085—leading naturally to a study of that microprocessor.",
                        ocr(p6, 5),
                    ),
                    block(
                        "paragraph",
                        "Part Three, Programming Popular Microprocessors, Chapters 13 to 23, simultaneously treats the M O S/Rockwell 6502, the Motorola 6800/6808, the Intel 8080/8085 and Zilog Z80, and the 16-bit Intel 8086/8088. Each chapter is divided into two sections. The first section presents new concepts; second section applies the new concepts to each microprocessor family. Discussion, programming examples, and problems are provided. The potential for comparative study is excellent.",
                        "Part 3, Programming Popular Microprocessors (Chapters 13 to 23), simultaneously treats the MOS/Rockwell 6502, the Motorola 6800/6808, the Intel 8080/8085 and Zilog Z80, and the 16-bit Intel 8086/8088. Each chapter is divided into two sections. The first section presents new concepts; second section applies the new concepts to each microprocessor family. Discussion, programming examples, and problems are provided. The potential for comparative study is excellent.",
                        ocr(p6, 6),
                    ),
                    block(
                        "paragraph",
                        "This part of the text takes a strong programming approach to the study of microprocessors. Study is centered around the microprocessor's instruction set and programming model.",
                        "This part of the text takes a strong programming approach to the study of microprocessors. Study is centered around the microprocessor's instruction set and programming model.",
                        ocr(p6, 7),
                    ),
                    block(
                        "paragraph",
                        "The 8-bit examples and homework problems can be performed by using either hand assembly or cross-assemblers. The 16-bit 8086/8088 examples and problems can be performed by using either an assembler or the D O S DEBUG utility.",
                        "The 8-bit examples and homework problems can be performed by using either hand assembly or cross-assemblers. The 16-bit 8086/8088 examples and problems can be performed by using either an assembler or the DOS DEBUG utility.",
                        ocr(p6, 8),
                    ),
                    block(
                        "paragraph",
                        "Part Four is devoted to the presentation of the instruction sets of each microprocessor family in table form. Several tables are provided for each microprocessor family, permitting instructions to be looked up alphabetically, by op code, or by functional category, with varying levels of detail. The same functional categories are correspondingly used in the chapters in Part Three. This coordination between parts makes the learning process easier and more enjoyable.",
                        "Part 4 is devoted to the presentation of the instruction sets of each microprocessor family in table form. Several tables are provided for each microprocessor family, permitting instructions to be looked up alphabetically, by op code, or by functional category, with varying levels of detail. The same functional categories are correspondingly used in the chapters in Part 3. This coordination between parts makes the learning process easier and more enjoyable.",
                        ocr(p6, 9),
                    ),
                    block(
                        "paragraph",
                        "Additional reference tables are provided in the appendixes. Answers to odd-numbered problems for Chapters 1 to 16 follow the appendixes.",
                        "Additional reference tables are provided in the appendixes. Answers to odd-numbered problems for Chapters 1 to 16 follow the appendixes.",
                        ocr(p6, 10),
                    ),
                    block(
                        "paragraph",
                        "A correlated laboratory manual, Experiments for Digital Computer Electronics by Michael A. Miller, is available for use with this textbook. It contains experiments for every part of the text. It also includes programming problems for each of the featured microprocessors.",
                        "A correlated laboratory manual, Experiments for Digital Computer Electronics by Michael A. Miller, is available for use with this textbook. It contains experiments for every part of the text. It also includes programming problems for each of the featured microprocessors.",
                        ocr(p6, 11),
                    ),
                    block(
                        "paragraph",
                        "A teacher's manual is available which contains answers to all of the problems and programs for every microprocessor. In addition, a diskette, M S-D O S 360 K, five and one-quarter-inch diskette, containing cross-assemblers is included in the teacher's manual.",
                        "A teacher's manual is available which contains answers to all of the problems and programs for every microprocessor. In addition, a diskette (MS-DOS 360K 5¼-inch diskette) containing cross-assemblers is included in the teacher's manual.",
                        ocr(p6, 12),
                    ),
                    block(
                        "paragraph",
                        "Special thanks to Brian Mackin for being such a patient and supportive editor. To Olive Collen for her editorial work. To Michael Miller for his work on the lab manual. And to Thomas Anderson of Speech Technologies Incorporated for the use of his cross-assemblers. Thanks also to reviewers Lawrence Fryda, Illinois State University; Malachi McGinnis, I T T Technical Institute, Garland, Texas; and Benjamin Suntag.",
                        "Special thanks to Brian Mackin for being such a patient and supportive editor. To Olive Collen for her editorial work. To Michael Miller for his work on the lab manual. And to Thomas Anderson of Speech Technologies Inc. for the use of his cross-assemblers. Thanks also to reviewers Lawrence Fryda, Illinois State University; Malachi McGinnis, ITT Technical Institute, Garland Texas; and Benjamin Suntag.",
                        ocr(p6, 13),
                    ),
                    block(
                        "paragraph",
                        "Albert Paul Malvino. Jerald A. Brown.",
                        "Albert Paul Malvino\nJerald A. Brown",
                        ocr(p6, 14),
                    ),
                    block(
                        "quote",
                        "A man of true science uses but few hard words, and those only when none other will answer his purpose; whereas the smatterer in science thinks that by mouthing hard words he understands hard things. Herman Melville.",
                        "A man of true science uses but few hard words,\nand those only when none other will answer his purpose;\nwhereas the smatterer in science thinks that\nby mouthing hard words he understands hard things.\nHerman Melville",
                        ocr(p6, 15, 16),
                    ),
                    block(
                        "page-number",
                        "six",
                        "vi",
                        ocr(p6, 17),
                        is_main=False,
                    ),
                ],
            },
        ),
        with_gold(
            by_id[p7],
            {
                "pageLanguage": "English",
                "blocks": [
                    block(
                        "heading",
                        "Part One. Digital Principles.",
                        "PART 1\nDIGITAL PRINCIPLES",
                        ocr(p7, 0),
                        level=1,
                    ),
                    block(
                        "figure",
                        "A small opening diagram shows three boxed symbols: an OR gate, the number one, and an AND gate.",
                        "1",
                        ocr(p7, 1),
                        is_figure=True,
                    ),
                    block(
                        "heading",
                        "Number Systems and Codes",
                        "NUMBER SYSTEMS\nAND CODES",
                        ocr(p7, 2),
                        level=1,
                    ),
                    block(
                        "paragraph",
                        "Modern computers don't work with decimal numbers. Instead, they process binary numbers, groups of zeros and ones. Why binary numbers? Because electronic devices are most reliable when designed for two-state, binary, operation. This chapter discusses binary numbers and other concepts needed to understand computer operation.",
                        "Modern computers don't work with decimal numbers. Instead, they process binary numbers, groups of 0s and 1s. Why binary numbers? Because electronic devices are most reliable when designed for two-state (binary) operation. This chapter discusses binary numbers and other concepts needed to understand computer operation.",
                        ocr(p7, 3),
                    ),
                    block(
                        "heading",
                        "One-one. Decimal Odometer",
                        "1-1 DECIMAL ODOMETER",
                        ocr(p7, 4),
                        level=2,
                    ),
                    block(
                        "paragraph",
                        "René Descartes, 1596 to 1650, said that the way to learn a new subject is to go from the known to the unknown, from the simple to the complex. Let's try it.",
                        "René Descartes (1596–1650) said that the way to learn a new subject is to go from the known to the unknown, from the simple to the complex. Let's try it.",
                        ocr(p7, 5),
                    ),
                    block("heading", "The Known", "The Known", ocr(p7, 6), level=2),
                    block(
                        "paragraph",
                        "Everyone has seen an odometer, miles indicator, in action. When a car is new, its odometer starts with",
                        "Everyone has seen an odometer (miles indicator) in action. When a car is new, its odometer starts with",
                        ocr(p7, 7),
                    ),
                    block("paragraph", "zero zero zero zero zero", "00000", ocr(p7, 8)),
                    block(
                        "paragraph",
                        "After one mile the reading becomes",
                        "After 1 mile the reading becomes",
                        ocr(p7, 9),
                    ),
                    block("paragraph", "zero zero zero zero one", "00001", ocr(p7, 10)),
                    block(
                        "paragraph",
                        "Successive miles produce zero zero zero zero two, zero zero zero zero three, and so on, up to zero zero zero zero nine.",
                        "Successive miles produce 00002, 00003, and so on, up to 00009",
                        ocr(p7, 11),
                    ),
                    block(
                        "paragraph",
                        "A familiar thing happens at the end of the tenth mile. When the units wheel turns from nine back to zero, a tab on this wheel forces the tens wheel to advance by one. This is why the numbers change to",
                        "A familiar thing happens at the end of the tenth mile. When the units wheel turns from 9 back to 0, a tab on this wheel forces the tens wheel to advance by 1. This is why the numbers change to",
                        ocr(p7, 12),
                    ),
                    block("paragraph", "zero zero zero one zero", "00010", ocr(p7, 13)),
                    block(
                        "heading",
                        "Reset-and-Carry",
                        "Reset-and-Carry",
                        ocr(p7, 14),
                        level=2,
                    ),
                    block(
                        "paragraph",
                        "The units wheel has reset to zero and sent a carry to the tens wheel. Let's call this familiar action reset-and-carry.",
                        "The units wheel has reset to 0 and sent a carry to the tens wheel. Let's call this familiar action reset-and-carry.",
                        ocr(p7, 15),
                    ),
                    block(
                        "paragraph",
                        "The other wheels also reset and carry. After 999 miles the odometer shows",
                        "The other wheels also reset and carry. After 999 miles the odometer shows",
                        ocr(p7, 16),
                    ),
                    block(
                        "paragraph", "zero zero nine nine nine", "00999", ocr(p7, 17)
                    ),
                    block(
                        "paragraph",
                        "What does the next mile do? The units wheel resets and carries, the tens wheel resets and carries, the hundreds wheel resets and carries, and the thousands wheel advances by one, to get",
                        "What does the next mile do? The units wheel resets and carries, the tens wheel resets and carries, the hundreds wheel resets and carries, and the thousands wheel advances by 1, to get",
                        ocr(p7, 18),
                    ),
                    block("paragraph", "zero one zero zero zero", "01000", ocr(p7, 19)),
                    block(
                        "heading",
                        "Digits and Strings",
                        "Digits and Strings",
                        ocr(p7, 20),
                        level=2,
                    ),
                    block(
                        "paragraph",
                        "The numbers on each odometer wheel are called digits. The decimal number system uses ten digits, zero through nine. In a decimal odometer, each time the units wheel runs out of digits, it resets to zero and sends a carry to the tens wheel. When the tens wheel runs out of digits, it resets to zero and sends a carry to the hundreds wheel. And so on with the remaining wheels.",
                        "The numbers on each odometer wheel are called digits. The decimal number system uses ten digits, 0 through 9. In a decimal odometer, each time the units wheel runs out of digits, it resets to 0 and sends a carry to the tens wheel. When the tens wheel runs out of digits, it resets to 0 and sends a carry to the hundreds wheel. And so on with the remaining wheels.",
                        ocr(p7, 21),
                    ),
                    block(
                        "paragraph",
                        "One more point. A string is a group of characters, either letters or digits, written one after another. For instance, 734 is a string of seven, three, and four. Similarly, two C eight A is a string of two, C, eight, and A.",
                        "One more point. A string is a group of characters (either letters or digits) written one after another. For instance, 734 is a string of 7, 3, and 4. Similarly, 2C8A is a string of 2, C, 8, and A.",
                        ocr(p7, 22),
                    ),
                    block(
                        "heading",
                        "One-two. Binary Odometer",
                        "1-2 BINARY ODOMETER",
                        ocr(p7, 23),
                        level=2,
                    ),
                    block(
                        "paragraph",
                        "Binary means two. The binary number system uses only two digits, zero and one. All other digits, two through nine, are thrown away. In other words, binary numbers are strings of zeros and ones.",
                        "Binary means two. The binary number system uses only two digits, 0 and 1. All other digits (2 through 9) are thrown away. In other words, binary numbers are strings of 0s and 1s.",
                        ocr(p7, 24),
                    ),
                    block(
                        "heading",
                        "An Unusual Odometer",
                        "An Unusual Odometer",
                        ocr(p7, 25),
                        level=2,
                    ),
                    block(
                        "paragraph",
                        "Visualize an odometer whose wheels have only two digits, zero and one. When each wheel turns, it displays zero, then one, then",
                        "Visualize an odometer whose wheels have only two digits, 0 and 1. When each wheel turns, it displays 0, then 1, then",
                        ocr(p7, 26),
                    ),
                    block("page-number", "one", "1", ocr(p7, 27), is_main=False),
                ],
            },
        ),
        with_gold(
            by_id[p8],
            {
                "pageLanguage": "English",
                "blocks": [
                    block(
                        "paragraph",
                        "back to zero, and the cycle repeats. Because each wheel has only two digits, we call this device a binary odometer.",
                        "back to 0, and the cycle repeats. Because each wheel has only two digits, we call this device a binary odometer.",
                        ocr(p8, 0),
                    ),
                    block(
                        "paragraph",
                        "In a car a binary odometer starts with zero zero zero zero, zero.",
                        "In a car a binary odometer starts with\n0000 (zero)",
                        ocr(p8, 1, 2),
                    ),
                    block(
                        "paragraph",
                        "After one mile, it indicates zero zero zero one, one.",
                        "After 1 mile, it indicates\n0001 (one)",
                        ocr(p8, 3, 4),
                    ),
                    block(
                        "paragraph",
                        "The next mile forces the units wheel to reset and carry; so the numbers change to zero zero one zero, two.",
                        "The next mile forces the units wheel to reset and carry; so the numbers change to\n0010 (two)",
                        ocr(p8, 5, 6),
                    ),
                    block(
                        "paragraph",
                        "The third mile results in zero zero one one, three.",
                        "The third mile results in\n0011 (three)",
                        ocr(p8, 7, 8),
                    ),
                    block(
                        "paragraph",
                        "What happens after four miles? The units wheel resets and carries, the second wheel resets and carries, and the third wheel advances by one. This gives zero one zero zero, four.",
                        "What happens after 4 miles? The units wheel resets and carries, the second wheel resets and carries, and the third wheel advances by 1. This gives\n0100 (four)",
                        ocr(p8, 9, 10),
                    ),
                    block(
                        "paragraph",
                        "Successive miles produce zero one zero one, five; zero one one zero, six; and zero one one one, seven.",
                        "Successive miles produce\n0101 (five)\n0110 (six)\n0111 (seven)",
                        ocr(p8, 11, 12, 13, 14),
                    ),
                    block(
                        "paragraph",
                        "After eight miles, the units wheel resets and carries, the second wheel resets and carries, the third wheel resets and carries, and the fourth wheel advances by one. The result is one zero zero zero, eight.",
                        "After 8 miles, the units wheel resets and carries, the second wheel resets and carries, the third wheel resets and carries, and the fourth wheel advances by 1. The result is\n1000 (eight)",
                        ocr(p8, 15, 16),
                    ),
                    block(
                        "paragraph",
                        "The ninth mile gives one zero zero one, nine; and the tenth mile produces one zero one zero, ten.",
                        "The ninth mile gives\n1001 (nine)\nand the tenth mile produces\n1010 (ten)",
                        ocr(p8, 17, 18, 19, 20),
                    ),
                    block(
                        "paragraph",
                        "Try working out a few more readings on your own.",
                        "(Try working out a few more readings on your own.)",
                        ocr(p8, 21),
                    ),
                    block(
                        "paragraph",
                        "You should have the idea by now. Each mile advances the units wheel by one. Whenever the units wheel runs out of digits, it resets and carries. Whenever the second wheel runs out of digits, it resets and carries. And so for the other wheels.",
                        "You should have the idea by now. Each mile advances the units wheel by 1. Whenever the units wheel runs out of digits, it resets and carries. Whenever the second wheel runs out of digits, it resets and carries. And so for the other wheels.",
                        ocr(p8, 22),
                    ),
                    block(
                        "heading",
                        "Binary Numbers",
                        "Binary Numbers",
                        ocr(p8, 23),
                        level=2,
                    ),
                    block(
                        "paragraph",
                        "A binary odometer displays binary numbers, strings of zeros and ones. The number zero zero zero one stands for one, zero zero one zero for two, zero zero one one for three, and so forth. Binary numbers are long when large amounts are involved. For instance, one zero one zero one zero represents decimal forty-two. As another example, one one one one zero zero zero zero one one one one stands for decimal three thousand eight hundred fifty-five.",
                        "A binary odometer displays binary numbers, strings of 0s and 1s. The number 0001 stands for 1, 0010 for 2, 0011 for 3, and so forth. Binary numbers are long when large amounts are involved. For instance, 101010 represents decimal 42. As another example, 111100001111 stands for decimal 3,855.",
                        ocr(p8, 24, 25),
                    ),
                    block(
                        "paragraph",
                        "Computer circuits are like binary odometers; they count and work with binary numbers. Therefore, you have to learn to count with binary numbers, to convert them to decimal numbers, and to do binary arithmetic. Then you will be ready to understand how computers operate.",
                        "Computer circuits are like binary odometers; they count and work with binary numbers. Therefore, you have to learn to count with binary numbers, to convert them to decimal numbers, and to do binary arithmetic. Then you will be ready to understand how computers operate.",
                        ocr(p8, 26),
                    ),
                    block(
                        "paragraph",
                        "A final point. When a decimal odometer shows zero zero three six, we can drop the leading zeros and read the number as 36. Similarly, when a binary odometer indicates zero zero one one, we can drop the leading zeros and read the number as one-one. With the leading zeros omitted, the binary numbers are zero, one, one-zero, one-one, one-zero-zero, one-zero-one, and so on. To avoid confusion with decimal numbers, read the binary numbers like this: zero, one, one-zero, one-one, one-zero-zero, one-zero-one, etc.",
                        "A final point. When a decimal odometer shows 0036, we can drop the leading 0s and read the number as 36. Similarly, when a binary odometer indicates 0011, we can drop the leading 0s and read the number as 11. With the leading 0s omitted, the binary numbers are 0, 1, 10, 11, 100, 101, and so on. To avoid confusion with decimal numbers, read the binary numbers like this: zero, one, one-zero, one-one, one-zero-zero, one-zero-one, etc.",
                        ocr(p8, 27),
                    ),
                    block(
                        "heading",
                        "One-three. Number Codes",
                        "1-3 NUMBER CODES",
                        ocr(p8, 28),
                        level=2,
                    ),
                    block(
                        "paragraph",
                        "People used to count with pebbles. The numbers one, two, three looked like one pebble, two pebbles, and three pebbles. Larger numbers were worse: seven appeared as seven pebbles.",
                        "People used to count with pebbles. The numbers 1, 2, 3 looked like ●, ●●, ●●●. Larger numbers were worse: seven appeared as ●●●●●●●.",
                        ocr(p8, 29),
                    ),
                    block("heading", "Codes", "Codes", ocr(p8, 30), level=2),
                    block(
                        "paragraph",
                        "From the earliest times, people have been creating codes that allow us to think, calculate, and communicate. The decimal numbers are an example of a code; see Table one-one. It's an old idea now, but at the time it was as revolutionary; one stands for one pebble, two for two pebbles, three for three pebbles, and so forth.",
                        "From the earliest times, people have been creating codes that allow us to think, calculate, and communicate. The decimal numbers are an example of a code (see Table 1-1). It's an old idea now, but at the time it was as revolutionary; 1 stands for ●, 2 for ●●, 3 for ●●●, and so forth.",
                        ocr(p8, 31),
                    ),
                    block(
                        "paragraph",
                        "Table one-one also shows the binary code. One stands for one pebble, one-zero for two pebbles, one-one for three pebbles, and so on. A binary number and a decimal number are equivalent if each represents the same amount of pebbles. Binary one-zero and decimal two are equivalent because each represents two pebbles. Binary one-zero-one and decimal five are equivalent because each stands for five pebbles.",
                        "Table 1-1 also shows the binary code. 1 stands for ●, 10 for ●●, 11 for ●●●, and so on. A binary number and a decimal number are equivalent if each represents the same amount of pebbles. Binary 10 and decimal 2 are equivalent because each represents ●●. Binary 101 and decimal 5 are equivalent because each stands for ●●●●●.",
                        ocr(p8, 32),
                    ),
                    block(
                        "caption",
                        "Table one-one. Number Codes.",
                        "TABLE 1-1. NUMBER CODES",
                        ocr(p8, 33),
                    ),
                    block(
                        "figure",
                        "A three-column table labeled Decimal, Pebbles, and Binary lists the codes for zero through nine. Zero is none and binary zero. One is one pebble and binary one. Two is two pebbles and binary one-zero. Three is three pebbles and binary one-one. Four is four pebbles and binary one-zero-zero. Five is five pebbles and binary one-zero-one. Six is six pebbles and binary one-one-zero. Seven is seven pebbles and binary one-one-one. Eight is eight pebbles and binary one-zero-zero-zero. Nine is nine pebbles and binary one-zero-zero-one.",
                        "Decimal Pebbles Binary\n0 None 0\n1 ● 1\n2 ●● 10\n3 ●●● 11\n4 ●●●● 100\n5 ●●●●● 101\n6 ●●●●●● 110\n7 ●●●●●●● 111\n8 ●●●●●●●● 1000\n9 ●●●●●●●●● 1001",
                        ocr(p8, 34),
                        is_figure=True,
                    ),
                    block(
                        "header-footer",
                        "Digital Computer Electronics, page two.",
                        "2 Digital Computer Electronics",
                        ocr(p8, 35),
                        is_main=False,
                    ),
                ],
            },
        ),
    ]

    write_jsonl(OUT, gold)
    print(f"wrote {len(gold)} records to {OUT.relative_to(PROJECT_ROOT)}")


if __name__ == "__main__":
    main()
