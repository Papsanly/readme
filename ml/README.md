# ML distillation workspace

This directory contains the reproducible artifacts for the document-to-TTS VLM distillation experiment.

## Directory layout

- `scripts/` — dataset rendering, DataLab extraction, validation, final merge, and stats scripts.
- `data/rendered/` — PNG pages rendered from the raw PDFs.
- `data/datalab/` — per-page DataLab Marker layout JSON.
- `data/annotations/` — silver, gold, and final teacher records.
- `data/dataset/` — train/val/test JSONL files and SFT message-format JSONL.
- `train/` — recommended training config and notes.
- `eval/` — evaluation scripts and notes.
- `server/` — FastAPI student VLM inference service skeleton and batch prediction client.

## Final dataset

Use `data/annotations/teacher_final_300.jsonl` as the canonical final teacher dataset.

The current dataset contains:

- 300 rendered page records;
- 300 DataLab layout records;
- 149 visually reviewed gold teacher records;
- 151 silver teacher records;
- 3566 narration blocks;
- 0 schema validation errors.

## Rebuild commands

From the project root `readme`:

1. Render PDF pages and create queue:

   `python ml/scripts/prepare_distillation_dataset.py --target-pages 300`

2. Run DataLab layout:

   `python ml/scripts/run_datalab_layout.py --poll-interval-sec 1`

3. Generate silver records:

   `python ml/scripts/generate_silver_teacher_dataset.py`

4. Merge gold overrides and silver records:

   `python ml/scripts/build_final_dataset.py`

5. Validate:

   `python ml/scripts/validate_vlm_dataset.py ml/data/annotations/teacher_final_300.jsonl`

6. Summarize:

   `python ml/scripts/summarize_dataset.py`

## Training input

Use the SFT files:

- `data/dataset/sft_train_final.jsonl`
- `data/dataset/sft_val_final.jsonl`
- `data/dataset/sft_test_final.jsonl`

Each SFT record contains:

- `image`: relative PNG path;
- `messages[0]`: system instruction;
- `messages[1]`: JSON user payload with context and OCR blocks;
- `messages[2]`: assistant JSON target (`VlmPageResult`).

## Student inference and evaluation

The ready-to-use local student adapter is documented in `MODEL_CARD.md`:

- adapter: `train/outputs/qwen25vl-3b-document-to-tts-lora-usable/`;
- server: `server/run_usable_student_server.py`;
- app integration: set `EXPO_PUBLIC_STUDENT_VLM_URL=http://127.0.0.1:8000`.

Start the ready server with:

`ml/.venv-gpu/Scripts/python.exe ml/server/run_usable_student_server.py --host 127.0.0.1 --port 8000`

See `server/README.md` for environment variables and smoke-test mode.

Generate predictions for the test split:

`python ml/server/predict_dataset.py --dataset ml/data/dataset/sft_test_final.jsonl --output ml/eval/student_predictions.jsonl`

Evaluate them:

`python ml/eval/evaluate_predictions.py --predictions ml/eval/student_predictions.jsonl --group-by-status --output ml/eval/student_eval_report.json`

## Notes

The final dataset intentionally tracks gold and silver status per record. When reporting thesis metrics, separate:

- full mixed dataset metrics;
- gold-only metrics;
- silver-only metrics if needed.
