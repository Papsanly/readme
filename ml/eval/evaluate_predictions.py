#!/usr/bin/env python3
"""Evaluate student VLM predictions against teacher records.

Expected prediction JSONL format:
- objects `{ "id": "...", "prediction": {"blocks": [...], "pageLanguage": "..."} }`;
- or full records containing `studentOutput`, `prediction`, or `teacherOutput`.

The script reports task-specific metrics for the ReadMe document-to-TTS VLM:
- strict-ish schema validity;
- page language accuracy;
- aligned block-type precision/recall/F1;
- `isMainContent`, skippable-service, and figure precision/recall/F1;
- OCR block id alignment precision/recall/F1;
- block count MAE and aligned text similarity.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable

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

SERVICE_TYPES = {"page-number", "footnote", "header-footer", "toc", "service"}
OUTPUT_KEYS = ("prediction", "studentOutput", "teacherOutput")


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


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def get_output(record: dict[str, Any]) -> dict[str, Any] | None:
    for key in OUTPUT_KEYS:
        value = record.get(key)
        if isinstance(value, dict):
            return value
    return None


def get_blocks(output: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(output, dict):
        return []
    blocks = output.get("blocks")
    if not isinstance(blocks, list):
        return []
    return [block for block in blocks if isinstance(block, dict)]


def valid_ocr_ids(record: dict[str, Any]) -> set[str]:
    ids: set[str] = set()
    for block in record.get("ocrBlocks", []):
        if isinstance(block, dict) and isinstance(block.get("id"), str):
            ids.add(block["id"])
    return ids


def block_ocr_ids(blocks: Iterable[dict[str, Any]]) -> set[str]:
    ids: set[str] = set()
    for block in blocks:
        value = block.get("ocrBlockIds")
        if isinstance(value, list):
            ids.update(v for v in value if isinstance(v, str) and v)
    return ids


def schema_errors(output: Any, page_ocr_ids: set[str] | None = None) -> list[str]:
    errors: list[str] = []
    if not isinstance(output, dict):
        return ["output_not_object"]

    if not isinstance(output.get("pageLanguage"), str) or not output.get(
        "pageLanguage"
    ):
        errors.append("pageLanguage_missing")

    blocks = output.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        return errors + ["blocks_missing"]

    used_ocr_ids: Counter[str] = Counter()
    for block in blocks:
        if not isinstance(block, dict):
            errors.append("block_not_object")
            continue
        if block.get("type") not in BLOCK_TYPES:
            errors.append("type_invalid")
        if not isinstance(block.get("text"), str) or not block.get("text"):
            errors.append("text_missing")
        if not isinstance(block.get("isFigure"), bool):
            errors.append("isFigure_invalid")
        if not isinstance(block.get("isMainContent"), bool):
            errors.append("isMainContent_invalid")
        if "level" in block and block.get("level") not in (1, 2):
            errors.append("level_invalid")
        if block.get("type") == "figure" and block.get("isFigure") is not True:
            errors.append("figure_flag_mismatch")
        if block.get("type") != "figure" and block.get("isFigure") is True:
            errors.append("non_figure_flag_mismatch")

        ids = block.get("ocrBlockIds")
        if not isinstance(ids, list):
            errors.append("ocrBlockIds_invalid")
        else:
            for oid in ids:
                if not isinstance(oid, str) or not oid:
                    errors.append("ocrBlockIds_invalid")
                    continue
                used_ocr_ids[oid] += 1
                if (
                    page_ocr_ids is not None
                    and page_ocr_ids
                    and oid not in page_ocr_ids
                ):
                    errors.append("ocrBlockIds_unknown")

    if any(count > 1 for count in used_ocr_ids.values()):
        errors.append("ocrBlockIds_duplicate")

    return errors


def prf(tp: int, fp: int, fn: int) -> dict[str, float]:
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"precision": precision, "recall": recall, "f1": f1}


def add_bool_counts(counter: Counter[str], truth: bool, predicted: bool) -> None:
    if truth and predicted:
        counter["tp"] += 1
    elif predicted and not truth:
        counter["fp"] += 1
    elif truth and not predicted:
        counter["fn"] += 1
    else:
        counter["tn"] += 1


def normalize_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.casefold().split())


def text_similarity(a: Any, b: Any) -> float:
    left = normalize_text(a)
    right = normalize_text(b)
    if not left and not right:
        return 1.0
    if not left or not right:
        return 0.0
    return SequenceMatcher(None, left, right).ratio()


def is_skippable_service(block: dict[str, Any] | None) -> bool:
    if not isinstance(block, dict):
        return False
    block_type = block.get("type")
    if block_type in SERVICE_TYPES:
        return True
    return block.get("isMainContent") is False


def annotation_status(record: dict[str, Any]) -> str:
    annotation = record.get("annotation")
    if not isinstance(annotation, dict):
        return "unknown"
    return str(annotation.get("status", "unknown"))


def status_group(record: dict[str, Any]) -> str:
    annotation = record.get("annotation")
    status = annotation_status(record)
    visual_reviewed = (
        isinstance(annotation, dict) and annotation.get("visualReviewed") is True
    )
    if visual_reviewed or status.startswith("gold"):
        return "gold"
    if status.startswith("silver") or "silver" in status:
        return "silver"
    return "unknown"


def filter_teacher_records(
    records: list[dict[str, Any]], *, split: str = "all", status: str = "all"
) -> list[dict[str, Any]]:
    out = records
    if split != "all":
        out = [record for record in out if record.get("split") == split]
    if status != "all":
        out = [record for record in out if status_group(record) == status]
    return out


def index_predictions(
    prediction_records: list[dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], list[str], int]:
    predictions: dict[str, dict[str, Any]] = {}
    duplicates: list[str] = []
    missing_id = 0
    for record in prediction_records:
        rid = record.get("id")
        if not isinstance(rid, str) or not rid:
            missing_id += 1
            continue
        if rid in predictions:
            duplicates.append(rid)
            continue
        predictions[rid] = record
    return predictions, duplicates, missing_id


def evaluate_subset(
    teacher_records: list[dict[str, Any]],
    prediction_records: list[dict[str, Any]],
    known_teacher_ids: set[str] | None = None,
) -> dict[str, Any]:
    predictions, duplicate_ids, prediction_records_without_id = index_predictions(
        prediction_records
    )
    expected_ids = {
        record["id"] for record in teacher_records if isinstance(record.get("id"), str)
    }
    all_known_ids = known_teacher_ids if known_teacher_ids is not None else expected_ids
    prediction_ids = set(predictions)

    missing_prediction_ids = sorted(expected_ids - prediction_ids)
    extra_prediction_ids = sorted(prediction_ids - all_known_ids)

    schema_valid = 0
    output_records = 0
    compared_records = 0
    page_language_correct = 0
    page_language_total = 0
    schema_error_counts: Counter[str] = Counter()

    block_type_tp: Counter[str] = Counter()
    block_type_fp: Counter[str] = Counter()
    block_type_fn: Counter[str] = Counter()
    main_counts: Counter[str] = Counter()
    skip_counts: Counter[str] = Counter()
    figure_counts: Counter[str] = Counter()
    ocr_counts: Counter[str] = Counter()
    unknown_predicted_ocr_ids = 0

    block_count_abs_error = 0
    block_count_records = 0
    text_similarity_sum = 0.0
    text_similarity_weighted_sum = 0.0
    text_similarity_pairs = 0
    text_similarity_weight = 0

    status_counts: Counter[str] = Counter(
        status_group(record) for record in teacher_records
    )
    split_counts: Counter[str] = Counter(
        str(record.get("split", "unknown")) for record in teacher_records
    )

    for teacher_record in teacher_records:
        rid = teacher_record.get("id")
        if not isinstance(rid, str):
            continue
        pred_record = predictions.get(rid)
        if not pred_record:
            continue

        output = get_output(pred_record)
        page_ocr_ids = valid_ocr_ids(teacher_record)
        errors = schema_errors(output, page_ocr_ids)
        if errors:
            schema_error_counts.update(errors)
        else:
            schema_valid += 1

        if not isinstance(output, dict):
            continue
        output_records += 1

        teacher_output = teacher_record.get("teacherOutput")
        teacher_language = (
            teacher_output.get("pageLanguage")
            if isinstance(teacher_output, dict)
            else None
        )
        predicted_language = output.get("pageLanguage")
        if isinstance(teacher_language, str) and teacher_language:
            page_language_total += 1
            if (
                isinstance(predicted_language, str)
                and teacher_language.casefold() == predicted_language.casefold()
            ):
                page_language_correct += 1

        true_blocks = get_blocks(
            teacher_output if isinstance(teacher_output, dict) else None
        )
        pred_blocks = get_blocks(output)
        if not true_blocks and not pred_blocks:
            continue

        compared_records += 1
        block_count_records += 1
        block_count_abs_error += abs(len(true_blocks) - len(pred_blocks))

        true_ocr_ids = block_ocr_ids(true_blocks)
        pred_ocr_ids = block_ocr_ids(pred_blocks)
        ocr_counts["tp"] += len(true_ocr_ids & pred_ocr_ids)
        ocr_counts["fp"] += len(pred_ocr_ids - true_ocr_ids)
        ocr_counts["fn"] += len(true_ocr_ids - pred_ocr_ids)
        unknown_predicted_ocr_ids += len(pred_ocr_ids - page_ocr_ids)

        max_len = max(len(true_blocks), len(pred_blocks))
        for i in range(max_len):
            tb = true_blocks[i] if i < len(true_blocks) else None
            pb = pred_blocks[i] if i < len(pred_blocks) else None

            true_type = tb.get("type", "unknown") if isinstance(tb, dict) else None
            pred_type = pb.get("type", "unknown") if isinstance(pb, dict) else None
            if true_type and pred_type and true_type == pred_type:
                block_type_tp[true_type] += 1
            else:
                if pred_type:
                    block_type_fp[pred_type] += 1
                if true_type:
                    block_type_fn[true_type] += 1

            add_bool_counts(
                main_counts,
                bool(isinstance(tb, dict) and tb.get("isMainContent")),
                bool(isinstance(pb, dict) and pb.get("isMainContent")),
            )
            add_bool_counts(
                skip_counts, is_skippable_service(tb), is_skippable_service(pb)
            )
            add_bool_counts(
                figure_counts,
                bool(isinstance(tb, dict) and tb.get("isFigure")),
                bool(isinstance(pb, dict) and pb.get("isFigure")),
            )

            if isinstance(tb, dict) and isinstance(pb, dict):
                similarity = text_similarity(tb.get("text"), pb.get("text"))
                weight = max(
                    len(normalize_text(tb.get("text"))),
                    len(normalize_text(pb.get("text"))),
                    1,
                )
                text_similarity_sum += similarity
                text_similarity_weighted_sum += similarity * weight
                text_similarity_pairs += 1
                text_similarity_weight += weight

    per_type: dict[str, dict[str, float]] = {}
    macro_f1_values: list[float] = []
    micro_tp = micro_fp = micro_fn = 0
    for block_type in sorted(BLOCK_TYPES):
        tp = block_type_tp[block_type]
        fp = block_type_fp[block_type]
        fn = block_type_fn[block_type]
        metric = prf(tp, fp, fn)
        per_type[block_type] = metric
        micro_tp += tp
        micro_fp += fp
        micro_fn += fn
        if tp + fn > 0:
            macro_f1_values.append(metric["f1"])

    expected_records = len(expected_ids)
    matched_prediction_records = expected_records - len(missing_prediction_ids)

    return {
        "records": {
            "teacherExpected": expected_records,
            "predictionRecordsRaw": len(prediction_records),
            "predictionRecordsIndexed": len(predictions),
            "matchedPredictionRecords": matched_prediction_records,
            "comparedRecords": compared_records,
            "outputRecords": output_records,
            "missingPredictionRecords": len(missing_prediction_ids),
            "extraPredictionRecords": len(extra_prediction_ids),
            "duplicatePredictionIds": len(duplicate_ids),
            "predictionRecordsWithoutId": prediction_records_without_id,
            "missingPredictionIdExamples": missing_prediction_ids[:20],
            "extraPredictionIdExamples": extra_prediction_ids[:20],
            "duplicatePredictionIdExamples": duplicate_ids[:20],
        },
        "dataset": {
            "statuses": dict(sorted(status_counts.items())),
            "splits": dict(sorted(split_counts.items())),
        },
        "schema": {
            "validRecords": schema_valid,
            "validRateExpected": schema_valid / expected_records
            if expected_records
            else 0.0,
            "validRateMatched": schema_valid / matched_prediction_records
            if matched_prediction_records
            else 0.0,
            "errorCounts": dict(sorted(schema_error_counts.items())),
        },
        "pageLanguage": {
            "accuracy": page_language_correct / page_language_total
            if page_language_total
            else 0.0,
            "correct": page_language_correct,
            "total": page_language_total,
        },
        "blockCount": {
            "mae": block_count_abs_error / block_count_records
            if block_count_records
            else 0.0,
            "records": block_count_records,
        },
        "text": {
            "alignedMeanSimilarity": text_similarity_sum / text_similarity_pairs
            if text_similarity_pairs
            else 0.0,
            "alignedWeightedSimilarity": text_similarity_weighted_sum
            / text_similarity_weight
            if text_similarity_weight
            else 0.0,
            "alignedPairs": text_similarity_pairs,
        },
        "isMainContent": prf(main_counts["tp"], main_counts["fp"], main_counts["fn"]),
        "skippableService": prf(
            skip_counts["tp"], skip_counts["fp"], skip_counts["fn"]
        ),
        "isFigure": prf(figure_counts["tp"], figure_counts["fp"], figure_counts["fn"]),
        "ocrBlockIds": {
            **prf(ocr_counts["tp"], ocr_counts["fp"], ocr_counts["fn"]),
            "unknownPredictedIds": unknown_predicted_ocr_ids,
        },
        "blockType": {
            "micro": prf(micro_tp, micro_fp, micro_fn),
            "macroF1SupportedTypes": sum(macro_f1_values) / len(macro_f1_values)
            if macro_f1_values
            else 0.0,
            "perType": per_type,
        },
    }


def build_report(args: argparse.Namespace) -> dict[str, Any]:
    teacher_raw = read_jsonl(Path(args.teacher))
    predictions_raw = read_jsonl(Path(args.predictions))
    teacher = filter_teacher_records(teacher_raw, split=args.split, status=args.status)
    known_teacher_ids = {
        record["id"] for record in teacher_raw if isinstance(record.get("id"), str)
    }

    report: dict[str, Any] = {
        "teacherPath": args.teacher,
        "predictionsPath": args.predictions,
        "filters": {"split": args.split, "status": args.status},
        "metrics": evaluate_subset(teacher, predictions_raw, known_teacher_ids),
    }

    if args.group_by_status and args.status == "all":
        split_filtered = filter_teacher_records(
            teacher_raw, split=args.split, status="all"
        )
        report["groups"] = {
            "gold": evaluate_subset(
                [record for record in split_filtered if status_group(record) == "gold"],
                predictions_raw,
                known_teacher_ids,
            ),
            "silver": evaluate_subset(
                [
                    record
                    for record in split_filtered
                    if status_group(record) == "silver"
                ],
                predictions_raw,
                known_teacher_ids,
            ),
        }

    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--teacher", default="ml/data/annotations/teacher_final_300.jsonl"
    )
    parser.add_argument("--predictions", required=True)
    parser.add_argument("--output", help="Optional JSON report path")
    parser.add_argument(
        "--split", choices=("all", "train", "val", "test"), default="all"
    )
    parser.add_argument("--status", choices=("all", "gold", "silver"), default="all")
    parser.add_argument(
        "--group-by-status",
        action="store_true",
        help="Also emit separate gold and silver metric groups when --status=all.",
    )
    args = parser.parse_args()

    report = build_report(args)
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    print(rendered)
    if args.output:
        write_json(Path(args.output), report)


if __name__ == "__main__":
    main()
