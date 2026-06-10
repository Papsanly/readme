#!/usr/bin/env python3
"""Run the ready-to-use ReadMe student VLM server.

Start from project root:

    ml/.venv-gpu/Scripts/python.exe ml/server/run_usable_student_server.py

Then set the mobile/app environment to use:

    EXPO_PUBLIC_STUDENT_VLM_URL=http://127.0.0.1:8000
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = PROJECT_ROOT / "ml" / ".cache"
DEFAULT_ADAPTER = (
    PROJECT_ROOT
    / "ml"
    / "train"
    / "outputs"
    / "qwen25vl-3b-document-to-tts-lora-usable"
)
DEFAULT_MODEL = "Qwen/Qwen2.5-VL-3B-Instruct"


def configure_env(args: argparse.Namespace) -> None:
    if not Path(args.adapter).exists():
        raise SystemExit(f"LoRA adapter directory does not exist: {args.adapter}")

    os.environ.pop("READ_ME_STUDENT_STUB", None)
    os.environ["READ_ME_STUDENT_MODEL"] = args.model
    os.environ["READ_ME_LORA_ADAPTER"] = str(args.adapter)
    os.environ["READ_ME_MAX_NEW_TOKENS"] = str(args.max_new_tokens)
    os.environ["READ_ME_OCR_TEXT_CHARS"] = str(args.ocr_text_chars)
    os.environ["READ_ME_MAX_OCR_BLOCKS"] = str(args.max_ocr_blocks)
    os.environ["READ_ME_ALIAS_OCR_IDS"] = "1"
    # Force full CUDA load on local 12 GB GPU. device_map=auto can offload
    # parts of the model to CPU/disk/meta and cause runtime device mismatch.
    os.environ.pop("READ_ME_DEVICE_MAP", None)
    os.environ.setdefault("PYTHONPATH", str(PROJECT_ROOT))
    os.environ.setdefault("HF_HOME", str(CACHE_DIR / "huggingface"))
    os.environ.setdefault("HF_HUB_CACHE", str(CACHE_DIR / "huggingface" / "hub"))
    os.environ.setdefault(
        "TRANSFORMERS_CACHE", str(CACHE_DIR / "huggingface" / "transformers")
    )
    os.environ.setdefault("TORCH_HOME", str(CACHE_DIR / "torch"))
    os.environ.setdefault("READ_ME_TORCH_DTYPE", args.dtype)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--adapter", default=str(DEFAULT_ADAPTER))
    parser.add_argument("--max-new-tokens", type=int, default=6144)
    parser.add_argument("--ocr-text-chars", type=int, default=120)
    parser.add_argument("--max-ocr-blocks", type=int, default=48)
    parser.add_argument(
        "--dtype", default="fp16", choices=("auto", "bf16", "fp16", "fp32")
    )
    args = parser.parse_args()

    if str(PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(PROJECT_ROOT))
    configure_env(args)

    import uvicorn

    uvicorn.run("ml.server.app:app", host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
