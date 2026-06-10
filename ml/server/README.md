# Student VLM inference server

This directory contains a small FastAPI service that exposes the same page-level contract as `src/types/vlm.ts`:

- input: `VlmAnalyzePageRequest` with a base64 page image, page metadata, context, and OCR blocks;
- output: `VlmPageResult` with narration-ready blocks and `pageLanguage`.

The server has two modes:

1. `stub` mode for endpoint smoke tests. It uses OCR hints only and does **not** represent model quality.
2. `qwen2.5-vl-lora` mode for a trained Qwen2.5-VL base model plus optional LoRA adapter.

## Install

From the project root:

`python -m pip install -r ml/server/requirements.txt`

For CUDA systems, install the appropriate `torch` build for your GPU first, then install the rest of the requirements.

## Smoke-test mode

PowerShell:

`$env:READ_ME_STUDENT_STUB = "1"`

`python -m uvicorn ml.server.app:app --host 127.0.0.1 --port 8000`

Health check:

`python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health').read().decode())"`

## Ready student mode

The current ready-to-use local adapter is:

`ml/train/outputs/qwen25vl-3b-document-to-tts-lora-usable/`

Start the server from the project root:

`ml/.venv-gpu/Scripts/python.exe ml/server/run_usable_student_server.py --host 127.0.0.1 --port 8000`

The script sets the recommended local inference options:

- `READ_ME_LORA_ADAPTER=ml/train/outputs/qwen25vl-3b-document-to-tts-lora-usable`;
- `READ_ME_MAX_NEW_TOKENS=6144`;
- `READ_ME_OCR_TEXT_CHARS=120`;
- `READ_ME_MAX_OCR_BLOCKS=48`;
- `READ_ME_ALIAS_OCR_IDS=1`.

To make the app use this local model instead of Anthropic, set:

`EXPO_PUBLIC_STUDENT_VLM_URL=http://127.0.0.1:8000`

## Manual real student mode

Set the base model and LoRA adapter path yourself:

`$env:READ_ME_STUDENT_MODEL = "Qwen/Qwen2.5-VL-3B-Instruct"`

`$env:READ_ME_LORA_ADAPTER = "ml/train/outputs/qwen25vl-3b-document-to-tts-lora-usable"`

`$env:READ_ME_MAX_NEW_TOKENS = "6144"`

`$env:READ_ME_ALIAS_OCR_IDS = "1"`

`ml/.venv-gpu/Scripts/python.exe -m uvicorn ml.server.app:app --host 127.0.0.1 --port 8000`

Useful optional variables:

- `READ_ME_MAX_NEW_TOKENS` — generation cap, default `4096`;
- `READ_ME_TORCH_DTYPE` — `auto`, `bf16`, `fp16`, or `fp32`;
- `READ_ME_DEVICE_MAP` — Hugging Face `device_map`, default `auto` when CUDA is available;
- `READ_ME_DEVICE` — CPU fallback device, default `cpu`.

## Generate predictions for evaluation

With the server running:

`python ml/server/predict_dataset.py --dataset ml/data/dataset/sft_test_final.jsonl --output ml/eval/student_predictions.jsonl`

Then evaluate:

`python ml/eval/evaluate_predictions.py --predictions ml/eval/student_predictions.jsonl --group-by-status --output ml/eval/student_eval_report.json`

For a quick contract test, run only a few records in stub mode:

`python ml/server/smoke_test_stub.py --limit 3 --output ml/eval/stub_predictions.jsonl`

`python ml/eval/evaluate_predictions.py --predictions ml/eval/stub_predictions.jsonl --output ml/eval/stub_eval_report.json`

For a real GPU LoRA server smoke test with the ready adapter:

`ml/.venv-gpu/Scripts/python.exe ml/server/smoke_test_student.py --limit 5 --output ml/eval/student_usable_predictions_5.jsonl --max-new-tokens 6144 --ocr-text-chars 120 --max-ocr-blocks 48`

`ml/.venv-gpu/Scripts/python.exe ml/eval/evaluate_predictions.py --predictions ml/eval/student_usable_predictions_5.jsonl --output ml/eval/student_usable_eval_5.json`

Full test split prediction/evaluation:

`ml/.venv-gpu/Scripts/python.exe ml/server/smoke_test_student.py --dataset ml/data/dataset/sft_test_final.jsonl --limit 32 --output ml/eval/student_usable_predictions_test.jsonl --max-new-tokens 6144 --ocr-text-chars 120 --max-ocr-blocks 48`

`ml/.venv-gpu/Scripts/python.exe ml/eval/evaluate_predictions.py --predictions ml/eval/student_usable_predictions_test.jsonl --split test --group-by-status --output ml/eval/student_usable_eval_test.json`

## API

`POST /analyze-page`

Request fields:

- `imageBase64`: base64 encoded PNG/JPEG/GIF/WebP page image;
- `imageMimeType`: image MIME type, defaults to `image/png`;
- `context`: book title, description, glossary, skipping mode, optional language;
- `pageNumber`, `totalPages`;
- `ocrBlocks`: list of `{id, label, text}` OCR/layout hints.

Response fields:

- `pageLanguage`;
- `blocks[]` with `type`, `text`, `rawText`, `caption`, `isFigure`, `isMainContent`, optional `level`, and `ocrBlockIds`.
