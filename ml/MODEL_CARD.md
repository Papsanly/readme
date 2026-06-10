# ReadMe student VLM model card

## Ready adapter

The ready-to-use local adapter is:

`ml/train/outputs/qwen25vl-3b-document-to-tts-lora-usable/`

Base model:

`Qwen/Qwen2.5-VL-3B-Instruct`

Task:

Document page image + OCR/layout hints -> `VlmPageResult` JSON for TTS narration blocks.

## Runtime

Use the GPU environment stored on the project drive:

- `ml/.venv-gpu/`
- `ml/.cache/`

Verified local runtime:

- GPU: `NVIDIA GeForce RTX 3080 Ti`
- torch: `2.6.0+cu124`
- CUDA runtime: `12.4`

Start the ready server:

`ml/.venv-gpu/Scripts/python.exe ml/server/run_usable_student_server.py --host 127.0.0.1 --port 8000`

Then configure the app to use it:

`EXPO_PUBLIC_STUDENT_VLM_URL=http://127.0.0.1:8000`

## Training run

Training script:

`ml/train/train_qwen25vl_lora.py`

Final local run:

`ml/.venv-gpu/Scripts/python.exe ml/train/train_qwen25vl_lora.py --output-dir ml/train/outputs/qwen25vl-3b-document-to-tts-lora-usable --epochs 3 --gradient-accumulation-steps 8 --max-length 2048 --max-pixels 100352 --min-pixels 100352 --ocr-text-chars 120 --max-ocr-blocks 48 --alias-ocr-ids --max-val-samples 16 --eval-records 8 --log-steps 20 --learning-rate 0.0001`

Run summary:

- train records: `236`
- epochs: `3`
- global steps: `708`
- optimizer steps: `90`
- skipped records: `0`
- peak GPU memory: `11.51 GiB`
- elapsed: `2477.807 sec`

The model was trained with compact OCR prompts and short OCR id aliases (`b0`, `b1`, ...). The inference server maps aliases back to original OCR ids before returning results.

## Test split evaluation

Predictions:

`ml/eval/student_usable_predictions_test.jsonl`

Report:

`ml/eval/student_usable_eval_test.json`

Test split summary (`32` pages):

- schema valid rate: `1.0`
- page language accuracy: `0.96875`
- block count MAE: `2.375`
- aligned mean text similarity: `0.6572`
- `isMainContent` F1: `0.8929`
- `isFigure` F1: `0.6596`
- OCR block id F1: `0.9887`
- block type micro F1: `0.7025`

Gold-only subset (`15` pages):

- schema valid rate: `1.0`
- page language accuracy: `1.0`
- block type micro F1: `0.5748`
- OCR block id F1: `0.9848`

Silver-only subset (`17` pages):

- schema valid rate: `1.0`
- page language accuracy: `0.9412`
- block type micro F1: `0.9333`
- OCR block id F1: `0.9965`

## Practical notes

This is a usable local prototype model, not a production-quality replacement for a large teacher VLM. It reliably returns schema-valid JSON from the local GPU server and can be integrated into the app through `EXPO_PUBLIC_STUDENT_VLM_URL`.

Known limitations:

- service block detection is still weak;
- gold-only metrics are lower than silver-only metrics because gold pages are more visually diverse and less templated;
- output can contain more/fewer blocks than the teacher on complex pages;
- quality should improve with more gold pages and a larger training window/GPU.
