# Evaluation

Use `evaluate_predictions.py` to compare student outputs against `teacher_final_300.jsonl`.

Expected prediction format is JSONL with one object per page:

- `id`: page record id matching the teacher dataset;
- `prediction`: student `VlmPageResult`.

The script also accepts full records containing `studentOutput`, `prediction`, or `teacherOutput`, which makes self-checking the teacher dataset possible.

## Example commands

Evaluate student predictions:

`python ml/eval/evaluate_predictions.py --predictions ml/eval/student_predictions.jsonl --group-by-status --output ml/eval/student_eval_report.json`

Evaluate only visually reviewed gold pages:

`python ml/eval/evaluate_predictions.py --predictions ml/eval/student_predictions.jsonl --status gold --output ml/eval/student_eval_gold.json`

Self-check the final teacher dataset:

`python ml/eval/evaluate_predictions.py --predictions ml/data/annotations/teacher_final_300.jsonl --group-by-status --output ml/eval/self_eval_report.json`

## Primary metrics

- `schema.validRateExpected` and `schema.errorCounts`;
- `pageLanguage.accuracy`;
- `blockType.micro`, `blockType.macroF1SupportedTypes`, and `blockType.perType`;
- `isMainContent`, `skippableService`, and `isFigure` precision/recall/F1;
- `ocrBlockIds` precision/recall/F1 and unknown predicted OCR ids;
- `blockCount.mae`;
- aligned text similarity.

For reports, separate mixed, gold-only, and silver-only metrics, then add qualitative examples and latency/cost measurements.
