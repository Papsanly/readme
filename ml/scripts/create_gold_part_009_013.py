#!/usr/bin/env python3
"""Create visually reviewed gold annotations for queue records 9-13."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SILVER = PROJECT_ROOT / "ml" / "data" / "annotations" / "teacher_silver_300.jsonl"
OUT = PROJECT_ROOT / "ml" / "data" / "annotations" / "gold_part_009_013.jsonl"


Block = dict[str, Any]


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


def oid(page_id: str, number: int) -> str:
    return f"ocr_{page_id}_{number:03d}"


def block(
    block_type: str,
    text: str,
    raw_text: str,
    ocr_ids: list[str],
    *,
    is_figure: bool = False,
    is_main: bool = True,
    level: int | None = None,
) -> Block:
    out: Block = {
        "type": block_type,
        "text": text,
        "rawText": raw_text,
        "isFigure": is_figure,
        "isMainContent": is_main,
        "ocrBlockIds": ocr_ids,
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


def page_0009(page_id: str) -> dict[str, Any]:
    return {
        "pageLanguage": "English",
        "blocks": [
            block(
                "paragraph",
                "Equivalence is the common ground between us and computers; it tells us when we're talking about the same thing. If a computer comes up with a binary answer of 101, equivalence means that the decimal answer is 5. As a start to understanding computers, memorize the binary-decimal equivalences of Table 1-1.",
                "Equivalence is the common ground between us and computers; it tells us when we're talking about the same thing. If a computer comes up with a binary answer of 101, equivalence means that the decimal answer is 5. As a start to understanding computers, memorize the binary-decimal equivalences of Table 1-1.",
                [oid(page_id, 0)],
            ),
            block("heading", "Example 1-1.", "EXAMPLE 1-1", [oid(page_id, 1)], level=2),
            block(
                "paragraph",
                "Figure 1-1a shows four light-emitting diodes, L E D's. A dark circle means that the L E D is off; a light circle means it's on. To read the display, use this code:",
                "Figure 1-1a shows four light-emitting diodes (LEDs). A dark circle means that the LED is off; a light circle means it's on. To read the display, use this code:",
                [oid(page_id, 2)],
            ),
            block(
                "figure",
                "Figure 1-1 shows two four-L E D displays. Display a is off, off, on, on, representing binary 0011; display b is off, on, off, on, representing binary 0101.",
                "(a) (b)",
                [oid(page_id, 3)],
                is_figure=True,
            ),
            block(
                "caption",
                "Figure 1-1. L E D display of binary numbers.",
                "Fig. 1-1 LED display of binary numbers.",
                [oid(page_id, 4)],
            ),
            block(
                "figure",
                "The code table says an off L E D represents binary 0, and an on L E D represents binary 1.",
                "LED Binary\nOff 0\nOn 1",
                [oid(page_id, 5)],
                is_figure=True,
            ),
            block(
                "paragraph",
                "What binary number does Figure 1-1a indicate? Figure 1-1b?",
                "What binary number does Fig. 1-1a indicate? Fig. 1-1b?",
                [oid(page_id, 6)],
            ),
            block("heading", "Solution.", "SOLUTION", [oid(page_id, 7)], level=2),
            block(
                "paragraph",
                "Figure 1-1a shows off-off-on-on. This stands for binary 0011, equivalent to decimal 3.",
                "Figure 1-1a shows off-off-on-on. This stands for binary 0011, equivalent to decimal 3.",
                [oid(page_id, 8)],
            ),
            block(
                "paragraph",
                "Figure 1-1b is off-on-off-on, decoded as binary 0101 and equivalent to decimal 5.",
                "Figure 1-1b is off-on-off-on, decoded as binary 0101 and equivalent to decimal 5.",
                [oid(page_id, 9)],
            ),
            block(
                "heading", "Example 1-2.", "EXAMPLE 1-2", [oid(page_id, 10)], level=2
            ),
            block(
                "paragraph",
                "A binary odometer has four wheels. What are the successive binary numbers?",
                "A binary odometer has four wheels. What are the successive binary numbers?",
                [oid(page_id, 11)],
            ),
            block("heading", "Solution.", "SOLUTION", [oid(page_id, 12)], level=2),
            block(
                "paragraph",
                "As previously discussed, the first eight binary numbers are 0000, 0001, 0010, 0011, 0100, 0101, 0110, and 0111. On the next count, the three wheels on the right reset and carry; the fourth wheel advances by one. So the next eight numbers are 1000, 1001, 1010, 1011, 1100, 1101, 1110, and 1111. The final reading of 1111 is equivalent to decimal 15. The next mile resets all wheels to 0, and the cycle repeats.",
                "As previously discussed, the first eight binary numbers are 0000, 0001, 0010, 0011, 0100, 0101, 0110, and 0111. On the next count, the three wheels on the right reset and carry; the fourth wheel advances by one. So the next eight numbers are 1000, 1001, 1010, 1011, 1100, 1101, 1110, and 1111. The final reading of 1111 is equivalent to decimal 15. The next mile resets all wheels to 0, and the cycle repeats.",
                [oid(page_id, 13)],
            ),
            block(
                "paragraph",
                "Being able to count in binary from 0000 to 1111 is essential for understanding the operation of computers.",
                "Being able to count in binary from 0000 to 1111 is essential for understanding the operation of computers.",
                [oid(page_id, 14)],
            ),
            block(
                "caption",
                "Table 1-2. Binary-to-decimal equivalences.",
                "TABLE 1-2. BINARY-TO-DECIMAL EQUIVALENCES",
                [oid(page_id, 15)],
            ),
            block(
                "figure",
                "Table 1-2 lists decimal numbers 0 through 15 and their four-bit binary equivalents: 0 is 0000, 1 is 0001, 2 is 0010, 3 is 0011, 4 is 0100, 5 is 0101, 6 is 0110, 7 is 0111, 8 is 1000, 9 is 1001, 10 is 1010, 11 is 1011, 12 is 1100, 13 is 1101, 14 is 1110, and 15 is 1111.",
                "Decimal Binary Decimal Binary\n0 0000 8 1000\n1 0001 9 1001\n2 0010 10 1010\n3 0011 11 1011\n4 0100 12 1100\n5 0101 13 1101\n6 0110 14 1110\n7 0111 15 1111",
                [oid(page_id, 16)],
                is_figure=True,
            ),
            block(
                "paragraph",
                "Therefore, you should memorize the equivalences of Table 1-2.",
                "Therefore, you should memorize the equivalences of Table 1-2.",
                [oid(page_id, 17)],
            ),
            block(
                "heading",
                "1-4. Why binary numbers are used.",
                "1-4 WHY BINARY NUMBERS ARE USED",
                [oid(page_id, 18)],
                level=1,
            ),
            block(
                "paragraph",
                'The word "computer" is misleading because it suggests a machine that can solve only numerical problems. But a computer is more than an automatic adding machine. It can play games, translate languages, draw pictures, and so on. To suggest this broad range of application, a computer is often referred to as a data processor.',
                'The word "computer" is misleading because it suggests a machine that can solve only numerical problems. But a computer is more than an automatic adding machine. It can play games, translate languages, draw pictures, and so on. To suggest this broad range of application, a computer is often referred to as a data processor.',
                [oid(page_id, 19)],
            ),
            block(
                "heading",
                "Program and Data.",
                "Program and Data",
                [oid(page_id, 20)],
                level=2,
            ),
            block(
                "paragraph",
                "Data means names, numbers, facts, anything needed to work out a problem. Data goes into a computer, where it is processed or manipulated to get new information. Before it goes into a computer, however, the data must be coded in binary form. The reason was given earlier: a computer's circuits can respond only to binary numbers.",
                "Data means names, numbers, facts, anything needed to work out a problem. Data goes into a computer, where it is processed or manipulated to get new information. Before it goes into a computer, however, the data must be coded in binary form. The reason was given earlier: a computer's circuits can respond only to binary numbers.",
                [oid(page_id, 21)],
            ),
            block(
                "paragraph",
                "Besides the data, someone has to work out a program, a list of instructions telling the computer what to do. These instructions spell out each and every step in the data processing. Like the data, the program must be coded in binary form before it goes into the computer.",
                "Besides the data, someone has to work out a program, a list of instructions telling the computer what to do. These instructions spell out each and every step in the data processing. Like the data, the program must be coded in binary form before it goes into the computer.",
                [oid(page_id, 22)],
            ),
            block(
                "paragraph",
                "So the two things we must input to a computer are the program and the data. These are stored inside the computer before the processing begins. Once the computer run starts, each instruction is executed and the data is processed.",
                "So the two things we must input to a computer are the program and the data. These are stored inside the computer before the processing begins. Once the computer run starts, each instruction is executed and the data is processed.",
                [oid(page_id, 23)],
            ),
            block(
                "heading",
                "Hardware and Software.",
                "Hardware and Software",
                [oid(page_id, 24)],
                level=2,
            ),
            block(
                "paragraph",
                'The electronic, magnetic, and mechanical devices of a computer are known as hardware. Programs are called software. Without software, a computer is a pile of "dumb" metal.',
                'The electronic, magnetic, and mechanical devices of a computer are known as hardware. Programs are called software. Without software, a computer is a pile of "dumb" metal.',
                [oid(page_id, 25)],
            ),
            block(
                "header-footer",
                "Chapter 1, Number Systems and Codes, page 3.",
                "Chapter 1 Number Systems and Codes 3",
                [oid(page_id, 26)],
                is_main=False,
            ),
        ],
    }


def page_0010(page_id: str) -> dict[str, Any]:
    return {
        "pageLanguage": "English",
        "blocks": [
            block(
                "paragraph",
                "An analogy may help. A phonograph is like hardware and records are like software. The phonograph is useless without records. Furthermore, the music you get depends on the record you play. A similar idea applies to computers. A computer is the hardware and programs are the software. The computer is useless without programs. The program stored in the computer determines what the computer will do; change the program and the computer processes the data in a different way.",
                "An analogy may help. A phonograph is like hardware and records are like software. The phonograph is useless without records. Furthermore, the music you get depends on the record you play. A similar idea applies to computers. A computer is the hardware and programs are the software. The computer is useless without programs. The program stored in the computer determines what the computer will do; change the program and the computer processes the data in a different way.",
                [oid(page_id, 0)],
            ),
            block("heading", "Transistors.", "Transistors", [oid(page_id, 1)], level=2),
            block(
                "paragraph",
                "Computers use integrated circuits, I C's, with thousands of transistors, either bipolar or M O S. The parameters, beta d c, I C O, g m, et cetera, can vary more than 50 percent with temperature change and from one transistor to the next. Yet these computer I C's work remarkably well despite the transistor variations. How is it possible?",
                "Computers use integrated circuits (ICs) with thousands of transistors, either bipolar or MOS. The parameters (βdc, ICO, gm, etc.) can vary more than 50 percent with temperature change and from one transistor to the next. Yet these computer ICs work remarkably well despite the transistor variations. How is it possible?",
                [oid(page_id, 2)],
            ),
            block(
                "paragraph",
                "The answer is two-state design, using only two points on the load line of each transistor. For instance, the common two-state design is the cutoff-saturation approach; each transistor is forced to operate at either cutoff or saturation. When a transistor is cut off or saturated, parameter variations have almost no effect. Because of this, it's possible to design reliable two-state circuits that are almost independent of temperature change and transistor variations.",
                "The answer is two-state design, using only two points on the load line of each transistor. For instance, the common two-state design is the cutoff-saturation approach; each transistor is forced to operate at either cutoff or saturation. When a transistor is cut off or saturated, parameter variations have almost no effect. Because of this, it's possible to design reliable two-state circuits that are almost independent of temperature change and transistor variations.",
                [oid(page_id, 3)],
            ),
            block(
                "heading",
                "Transistor Register.",
                "Transistor Register",
                [oid(page_id, 4)],
                level=2,
            ),
            block(
                "paragraph",
                "Here's an example of two-state design. Figure 1-2 shows a transistor register. A register is a string of devices that store data. The transistors on the left are cut off because the input base voltages are 0 volts. The dark shading symbolizes the cutoff condition. The two transistors on the right have base drives of 5 volts.",
                "Here's an example of two-state design. Figure 1-2 shows a transistor register. (A register is a string of devices that store data.) The transistors on the left are cut off because the input base voltages are 0 V. The dark shading symbolizes the cutoff condition. The two transistors on the right have base drives of 5 V.",
                [oid(page_id, 5)],
            ),
            block(
                "paragraph",
                "The transistors operate at either saturation or cutoff. A base voltage of 0 volts forces each transistor to cut off, while a base voltage of 5 volts drives it into saturation. Because of this two-state action, each transistor stays in a given state until the base voltage switches it to the opposite state.",
                "The transistors operate at either saturation or cutoff. A base voltage of 0 V forces each transistor to cut off, while a base voltage of 5 V drives it into saturation. Because of this two-state action, each transistor stays in a given state until the base voltage switches it to the opposite state.",
                [oid(page_id, 6)],
            ),
            block(
                "figure",
                "Figure 1-2 is a four-bit transistor register made of four transistor stages connected to a plus 5 volt supply. The two left transistors are shaded to show cutoff with 0 volt base inputs and high collector outputs; the two right transistors have plus 5 volt base drives and approximately 0 volt collector outputs.",
                "Four transistor stages with 1 kΩ collector resistors, 10 kΩ input resistors, +5 V supply, 0 V and +5 V input labels, and approximate 0 V output labels on the saturated stages.",
                [oid(page_id, 16)],
                is_figure=True,
            ),
            block(
                "caption",
                "Figure 1-2. Transistor register.",
                "Fig. 1-2 Transistor register.",
                [oid(page_id, 17)],
            ),
            block(
                "heading", "Another Code.", "Another Code", [oid(page_id, 7)], level=2
            ),
            block(
                "paragraph",
                "Two-state operation is universal in digital electronics. By deliberate design, all input and output voltages are either low or high. Here's how binary numbers come in: low voltage represents binary 0, and high voltage stands for binary 1. In other words, we use this code:",
                "Two-state operation is universal in digital electronics. By deliberate design, all input and output voltages are either low or high. Here's how binary numbers come in: low voltage represents binary 0, and high voltage stands for binary 1. In other words, we use this code:",
                [oid(page_id, 8)],
            ),
            block(
                "figure",
                "The code table says low voltage represents binary 0, and high voltage represents binary 1.",
                "Voltage Binary\nLow 0\nHigh 1",
                [oid(page_id, 9)],
                is_figure=True,
            ),
            block(
                "paragraph",
                "For instance, the base voltages of Figure 1-2 are low-low-high-high, or binary 0011. The collector voltages are high-high-low-low, or binary 1100. By changing the base voltages we can store any binary number from 0000 to 1111, decimal 0 to 15.",
                "For instance, the base voltages of Fig. 1-2 are low-low-high-high, or binary 0011. The collector voltages are high-high-low-low, or binary 1100. By changing the base voltages we can store any binary number from 0000 to 1111 (decimal 0 to 15).",
                [oid(page_id, 10)],
            ),
            block("heading", "Bit.", "Bit", [oid(page_id, 11)], level=2),
            block(
                "paragraph",
                "Bit is an abbreviation for binary digit. A binary number like 1100 has 4 bits; 110011 has 6 bits; and 11001100 has 8 bits. Figure 1-2 is a 4-bit register. To store larger binary numbers, it needs more transistors. Add two transistors and you get a 6-bit register. With four more transistors, you'd have an 8-bit register.",
                "Bit is an abbreviation for binary digit. A binary number like 1100 has 4 bits; 110011 has 6 bits; and 11001100 has 8 bits. Figure 1-2 is a 4-bit register. To store larger binary numbers, it needs more transistors. Add two transistors and you get a 6-bit register. With four more transistors, you'd have an 8-bit register.",
                [oid(page_id, 12)],
            ),
            block(
                "heading",
                "Nonsaturated Circuits.",
                "Nonsaturated Circuits",
                [oid(page_id, 13)],
                level=2,
            ),
            block(
                "paragraph",
                "Don't get the idea that all two-state circuits switch between cutoff and saturation. When a bipolar transistor is heavily saturated, extra carriers are stored in the base region. If the base voltage suddenly switches from high to low, the transistor cannot come out of saturation until these extra carriers have a chance to leave the base region. The time it takes for these carriers to leave is called the saturation delay time, t d. Typically, t d is in nanoseconds.",
                "Don't get the idea that all two-state circuits switch between cutoff and saturation. When a bipolar transistor is heavily saturated, extra carriers are stored in the base region. If the base voltage suddenly switches from high to low, the transistor cannot come out of saturation until these extra carriers have a chance to leave the base region. The time it takes for these carriers to leave is called the saturation delay time td. Typically, td is in nanoseconds.",
                [oid(page_id, 14)],
            ),
            block(
                "paragraph",
                "In most applications the saturation delay time is too short to matter. But some applications require the fastest possible",
                "In most applications the saturation delay time is too short to matter. But some applications require the fastest possible",
                [oid(page_id, 15)],
            ),
            block(
                "header-footer",
                "Page 4, Digital Computer Electronics.",
                "4 Digital Computer Electronics",
                [oid(page_id, 18)],
                is_main=False,
            ),
        ],
    }


def copy_output(record: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(record["teacherOutput"], ensure_ascii=False))


def patch_output(
    record: dict[str, Any],
    patches: dict[int, dict[str, Any]],
    *,
    footer_text: str,
    footer_raw: str,
    footer_id: str,
) -> dict[str, Any]:
    output = copy_output(record)
    for index, values in patches.items():
        output["blocks"][index].update(values)
    if all(footer_id not in b.get("ocrBlockIds", []) for b in output["blocks"]):
        output["blocks"].append(
            block(
                "header-footer",
                footer_text,
                footer_raw,
                [footer_id],
                is_main=False,
            )
        )
    return output


def main() -> None:
    records = read_jsonl(SILVER)
    by_id = {record["id"]: record for record in records}

    p9 = "digital-computer-electronics-albert-paul-malvino-and-jerald-a-brown_p0009"
    p10 = "digital-computer-electronics-albert-paul-malvino-and-jerald-a-brown_p0010"
    p11 = "digital-computer-electronics-albert-paul-malvino-and-jerald-a-brown_p0011"
    p12 = "digital-computer-electronics-albert-paul-malvino-and-jerald-a-brown_p0012"
    p15 = "digital-computer-electronics-albert-paul-malvino-and-jerald-a-brown_p0015"

    p11_output = patch_output(
        by_id[p11],
        {
            2: {
                "text": "Figure 1-3 shows a core register in two views. Part a shows four magnetic cores threaded by diagonal wires with current arrows producing flux; part b shows the same cores retaining their flux after the magnetizing current is removed.",
                "rawText": "(a) (b)",
            },
            7: {
                "text": "The code table says counterclockwise flux represents binary 0, and clockwise flux represents binary 1.",
                "rawText": "Flux Binary\nCounterclockwise 0\nClockwise 1",
            },
            15: {"type": "paragraph", "isMainContent": True},
            19: {
                "text": "Figure 1-4 shows a strip of magnetic tape with seven horizontal rows of eight circles. Black circles are magnetized points, and white circles are unmagnetized points.",
                "rawText": "Seven rows of black and white circles on a magnetic tape strip.",
            },
            23: {
                "text": "The solution table lists these binary numbers: row 1, 00001111; row 2, 10000110; row 3, 10110111; row 4, 00110001; row 5, 11100110; row 6, 01001001; and row 7, 11001101.",
                "rawText": "Row 1 00001111  Row 5 11100110\nRow 2 10000110  Row 6 01001001\nRow 3 10110111  Row 7 11001101\nRow 4 00110001",
            },
        },
        footer_text="Chapter 1, Number Systems and Codes, page 5.",
        footer_raw="Chapter 1 Number Systems and Codes 5",
        footer_id=oid(p11, 24),
    )

    p12_output = patch_output(
        by_id[p12],
        {
            0: {"type": "paragraph", "isMainContent": True},
            5: {
                "text": "Figure 1-5 compares decimal and binary positional weights. Part a shows decimal digits 5, 7, 0, 3, and 4 over weights 10 to the fourth through 10 to the zero; part b shows binary digits 1, 1, 0, 0, and 1 over weights 2 to the fourth through 2 to the zero.",
                "rawText": "5 7 0 3 4 over 10^4 10^3 10^2 10^1 10^0; 1 1 0 0 1 over 2^4 2^3 2^2 2^1 2^0",
            },
            10: {
                "text": "The sum is 5 times 10 to the fourth, plus 7 times 10 to the third, plus 0 times 10 squared, plus 3 times 10 to the first, plus 4 times 10 to the zero. This equals 50,000 plus 7,000 plus 0 plus 30 plus 4, which equals 57,034.",
            },
            14: {
                "text": "The sum is 1 times 2 to the fourth, plus 1 times 2 to the third, plus 0 times 2 squared, plus 0 times 2 to the first, plus 1 times 2 to the zero. This equals 16 plus 8 plus 0 plus 0 plus 1, which equals 25.",
            },
            17: {
                "text": "The byte 11001100 converts as 1 times 2 to the seventh, plus 1 times 2 to the sixth, plus 0 times 2 to the fifth, plus 0 times 2 to the fourth, plus 1 times 2 cubed, plus 1 times 2 squared, plus 0 times 2 to the first, plus 0 times 2 to the zero. This equals 128 plus 64 plus 0 plus 0 plus 8 plus 4 plus 0 plus 0, or 204.",
            },
            21: {
                "text": "First, write the binary number. Second, write the weights 1, 2, 4, 8, and so on, under the binary digits. Third, cross out any weight under a 0. Fourth, add the remaining weights.",
            },
            23: {
                "text": "For binary 1101: first write 1, 1, 0, 1. Then write weights 8, 4, 2, 1. Cross out the 2 under the 0. Finally, add 8 plus 4 plus 0 plus 1 to get 13.",
            },
            25: {
                "text": "Compressed, write 1101 above weights 8, 4, 2, and 1; cross out 2, and 8 plus 4 plus 1 gives 13.",
            },
            27: {
                "text": "For binary 1110101, write weights 64, 32, 16, 8, 4, 2, and 1. Cross out 8 and 2; 64 plus 32 plus 16 plus 4 plus 1 gives 117.",
            },
        },
        footer_text="Page 6, Digital Computer Electronics.",
        footer_raw="6 Digital Computer Electronics",
        footer_id=oid(p12, 31),
    )

    p15_output = patch_output(
        by_id[p15],
        {
            6: {
                "text": "If used in a car, a hexadecimal odometer would count as follows. When the car is new, the odometer shows all zeros:"
            },
            25: {
                "text": "Table 1-4 gives hexadecimal, binary, and decimal equivalences: hexadecimal 0 through 9 match decimal 0 through 9 and binary 0000 through 1001; A is 1010 and decimal 10, B is 1011 and decimal 11, C is 1100 and decimal 12, D is 1101 and decimal 13, E is 1110 and decimal 14, and F is 1111 and decimal 15.",
                "rawText": "Hexadecimal Binary Decimal\n0 0000 0\n1 0001 1\n2 0010 2\n3 0011 3\n4 0100 4\n5 0101 5\n6 0110 6\n7 0111 7\n8 1000 8\n9 1001 9\nA 1010 10\nB 1011 11\nC 1100 12\nD 1101 13\nE 1110 14\nF 1111 15",
            },
        },
        footer_text="Chapter 1, Number Systems and Codes, page 9.",
        footer_raw="Chapter 1 Number Systems and Codes 9",
        footer_id=oid(p15, 26),
    )

    gold = [
        with_gold(by_id[p9], page_0009(p9)),
        with_gold(by_id[p10], page_0010(p10)),
        with_gold(by_id[p11], p11_output),
        with_gold(by_id[p12], p12_output),
        with_gold(by_id[p15], p15_output),
    ]

    write_jsonl(OUT, gold)
    print(f"wrote {len(gold)} records to {OUT.relative_to(PROJECT_ROOT)}")


if __name__ == "__main__":
    main()
