#!/usr/bin/env python3
"""LoRA SFT training for the ReadMe document-to-TTS Qwen2.5-VL student.

The script intentionally uses a small, explicit PyTorch loop instead of Trainer
so it can run constrained smoke/full experiments on a local Windows GPU.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import time
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ML_DIR = PROJECT_ROOT / "ml"
CACHE_DIR = ML_DIR / ".cache"

# Keep large model/cache artifacts on the project drive unless the user already
# provided explicit cache locations.
os.environ.setdefault("HF_HOME", str(CACHE_DIR / "huggingface"))
os.environ.setdefault("HF_HUB_CACHE", str(CACHE_DIR / "huggingface" / "hub"))
os.environ.setdefault(
    "TRANSFORMERS_CACHE", str(CACHE_DIR / "huggingface" / "transformers")
)
os.environ.setdefault("TORCH_HOME", str(CACHE_DIR / "torch"))
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import torch
from peft import LoraConfig, get_peft_model
from PIL import Image
from qwen_vl_utils import process_vision_info
from transformers import AutoProcessor, Qwen2_5_VLForConditionalGeneration

DEFAULT_MODEL = "Qwen/Qwen2.5-VL-3B-Instruct"
DEFAULT_TRAIN = PROJECT_ROOT / "ml" / "data" / "dataset" / "sft_train_final.jsonl"
DEFAULT_VAL = PROJECT_ROOT / "ml" / "data" / "dataset" / "sft_val_final.jsonl"
DEFAULT_OUTPUT = (
    PROJECT_ROOT / "ml" / "train" / "outputs" / "qwen25vl-3b-document-to-tts-lora"
)

SYSTEM_FALLBACK = (
    "You are an OCR + TTS-normalization assistant for an audiobook generator. "
    "Inspect the page image and OCR layout hints. Return strict JSON matching "
    "VlmPageResult: {blocks, pageLanguage}."
)

LORA_TARGET_MODULES = [
    "q_proj",
    "k_proj",
    "v_proj",
    "o_proj",
    "gate_proj",
    "up_proj",
    "down_proj",
]


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


def sample_records(
    records: list[dict[str, Any]], limit: int, seed: int
) -> list[dict[str, Any]]:
    if limit <= 0 or limit >= len(records):
        return records
    rng = random.Random(seed)
    out = records[:]
    rng.shuffle(out)
    return out[:limit]


def prepare_sft_contents(
    user_content: str,
    assistant_content: str,
    ocr_text_chars: int,
    max_ocr_blocks: int,
    alias_ocr_ids: bool,
) -> tuple[str, str]:
    try:
        payload = json.loads(user_content)
    except json.JSONDecodeError:
        return user_content, assistant_content
    if not isinstance(payload, dict):
        return user_content, assistant_content

    original_to_alias: dict[str, str] = {}
    ocr_blocks = payload.get("ocrBlocks")
    if isinstance(ocr_blocks, list):
        blocks = ocr_blocks[:max_ocr_blocks] if max_ocr_blocks > 0 else ocr_blocks
        compacted: list[Any] = []
        for index, block in enumerate(blocks):
            if not isinstance(block, dict):
                compacted.append(block)
                continue
            item = dict(block)
            original_id = item.get("id")
            if alias_ocr_ids and isinstance(original_id, str) and original_id:
                alias = f"b{index}"
                original_to_alias[original_id] = alias
                item["id"] = alias
            text = item.get("text")
            if (
                ocr_text_chars > 0
                and isinstance(text, str)
                and len(text) > ocr_text_chars
            ):
                item["text"] = text[:ocr_text_chars].rstrip() + "…"
            compacted.append(item)
        payload["ocrBlocks"] = compacted

    if alias_ocr_ids and original_to_alias:
        try:
            target = json.loads(assistant_content)
        except json.JSONDecodeError:
            target = None
        if isinstance(target, dict) and isinstance(target.get("blocks"), list):
            for block in target["blocks"]:
                if not isinstance(block, dict):
                    continue
                ocr_ids = block.get("ocrBlockIds")
                if isinstance(ocr_ids, list):
                    block["ocrBlockIds"] = [
                        original_to_alias[oid]
                        for oid in ocr_ids
                        if isinstance(oid, str) and oid in original_to_alias
                    ]
            assistant_content = json.dumps(target, ensure_ascii=False)

    return json.dumps(payload, ensure_ascii=False), assistant_content


def sft_messages(
    record: dict[str, Any],
    ocr_text_chars: int,
    max_ocr_blocks: int,
    alias_ocr_ids: bool,
) -> tuple[list[dict[str, Any]], str]:
    messages = record.get("messages")
    if not isinstance(messages, list) or len(messages) < 3:
        raise ValueError(f"{record.get('id', '<unknown>')}: expected 3 SFT messages")

    system_content = (
        messages[0].get("content") if isinstance(messages[0], dict) else None
    )
    user_content = messages[1].get("content") if isinstance(messages[1], dict) else None
    assistant_content = (
        messages[2].get("content") if isinstance(messages[2], dict) else None
    )

    if not isinstance(system_content, str) or not system_content.strip():
        system_content = SYSTEM_FALLBACK
    if not isinstance(user_content, str) or not user_content.strip():
        raise ValueError(f"{record.get('id', '<unknown>')}: missing user content")
    if not isinstance(assistant_content, str) or not assistant_content.strip():
        raise ValueError(f"{record.get('id', '<unknown>')}: missing assistant content")
    user_content, assistant_content = prepare_sft_contents(
        user_content,
        assistant_content,
        ocr_text_chars,
        max_ocr_blocks,
        alias_ocr_ids,
    )

    image_value = record.get("image")
    if not isinstance(image_value, str) or not image_value:
        raise ValueError(f"{record.get('id', '<unknown>')}: missing image path")
    image_path = PROJECT_ROOT / image_value
    if not image_path.exists():
        raise FileNotFoundError(f"image does not exist: {image_path}")

    image = Image.open(image_path).convert("RGB")
    prompt_messages = [
        {"role": "system", "content": system_content},
        {
            "role": "user",
            "content": [
                {"type": "image", "image": image},
                {"type": "text", "text": user_content},
            ],
        },
    ]
    return prompt_messages, assistant_content


def move_batch_to_device(batch: Any, device: torch.device) -> Any:
    return batch.to(device)


def prepare_sample(
    processor: Any,
    record: dict[str, Any],
    device: torch.device,
    max_length: int,
    ocr_text_chars: int,
    max_ocr_blocks: int,
    alias_ocr_ids: bool,
) -> dict[str, torch.Tensor] | None:
    prompt_messages, assistant_content = sft_messages(
        record, ocr_text_chars, max_ocr_blocks, alias_ocr_ids
    )
    full_messages = prompt_messages + [
        {"role": "assistant", "content": assistant_content}
    ]

    prompt_text = processor.apply_chat_template(
        prompt_messages, tokenize=False, add_generation_prompt=True
    )
    full_text = processor.apply_chat_template(
        full_messages, tokenize=False, add_generation_prompt=False
    )

    image_inputs, video_inputs = process_vision_info(prompt_messages)
    prompt_inputs = processor(
        text=[prompt_text],
        images=image_inputs,
        videos=video_inputs,
        padding=True,
        truncation=True,
        max_length=max_length,
        return_tensors="pt",
    )
    full_inputs = processor(
        text=[full_text],
        images=image_inputs,
        videos=video_inputs,
        padding=True,
        truncation=True,
        max_length=max_length,
        return_tensors="pt",
    )

    labels = full_inputs.input_ids.clone()
    prompt_len = min(prompt_inputs.input_ids.shape[1], labels.shape[1])
    labels[:, :prompt_len] = -100
    pad_id = processor.tokenizer.pad_token_id
    if pad_id is not None:
        labels[labels == pad_id] = -100
    if int((labels != -100).sum().item()) == 0:
        return None

    full_inputs["labels"] = labels
    return move_batch_to_device(full_inputs, device)


def load_model_and_processor(args: argparse.Namespace) -> tuple[Any, Any, torch.device]:
    if not torch.cuda.is_available():
        raise SystemExit(
            "CUDA GPU is required for this training script, but torch.cuda.is_available() is false"
        )
    device = torch.device("cuda")
    print(f"CUDA device: {torch.cuda.get_device_name(0)}")
    print(f"CUDA capability: {torch.cuda.get_device_capability(0)}")

    processor = AutoProcessor.from_pretrained(
        args.model,
        trust_remote_code=True,
        min_pixels=args.min_pixels,
        max_pixels=args.max_pixels,
    )
    if processor.tokenizer.pad_token_id is None:
        processor.tokenizer.pad_token = processor.tokenizer.eos_token

    model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
        args.model,
        torch_dtype=torch.float16,
        attn_implementation=args.attn_implementation,
        trust_remote_code=True,
    )
    model.config.use_cache = False
    model.gradient_checkpointing_enable()
    if hasattr(model, "enable_input_require_grads"):
        model.enable_input_require_grads()
    model.to(device)

    lora_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=LORA_TARGET_MODULES,
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()
    return model, processor, device


def evaluate_loss(
    model: Any,
    processor: Any,
    records: list[dict[str, Any]],
    device: torch.device,
    max_length: int,
    max_records: int,
    ocr_text_chars: int,
    max_ocr_blocks: int,
    alias_ocr_ids: bool,
) -> dict[str, float]:
    if max_records <= 0 or not records:
        return {"loss": math.nan, "records": 0}
    losses: list[float] = []
    model.eval()
    with torch.no_grad():
        for record in records[:max_records]:
            batch = prepare_sample(
                processor,
                record,
                device,
                max_length,
                ocr_text_chars=ocr_text_chars,
                max_ocr_blocks=max_ocr_blocks,
                alias_ocr_ids=alias_ocr_ids,
            )
            if batch is None:
                continue
            with torch.autocast(device_type="cuda", dtype=torch.float16):
                loss = model(**batch).loss
            losses.append(float(loss.detach().cpu()))
    model.train()
    return {
        "loss": sum(losses) / len(losses) if losses else math.nan,
        "records": len(losses),
    }


def train(args: argparse.Namespace) -> None:
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.cuda.manual_seed_all(args.seed)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    train_records = sample_records(
        read_jsonl(Path(args.train)), args.max_train_samples, args.seed
    )
    val_records = sample_records(
        read_jsonl(Path(args.val)), args.max_val_samples, args.seed + 1
    )

    model, processor, device = load_model_and_processor(args)
    trainable = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.AdamW(
        trainable, lr=args.learning_rate, weight_decay=args.weight_decay
    )
    scaler = torch.amp.GradScaler("cuda", enabled=True)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    write_json(
        output_dir / "run_config.json",
        {
            **vars(args),
            "torch": torch.__version__,
            "cuda": torch.version.cuda,
            "gpu": torch.cuda.get_device_name(0),
            "trainRecords": len(train_records),
            "valRecords": len(val_records),
            "hfHome": os.environ.get("HF_HOME"),
        },
    )

    global_step = 0
    optimizer_steps = 0
    skipped = 0
    started = time.time()
    model.train()
    optimizer.zero_grad(set_to_none=True)

    for epoch in range(args.epochs):
        random.shuffle(train_records)
        for record_index, record in enumerate(train_records, start=1):
            batch = prepare_sample(
                processor,
                record,
                device,
                args.max_length,
                args.ocr_text_chars,
                args.max_ocr_blocks,
                args.alias_ocr_ids,
            )
            if batch is None:
                skipped += 1
                continue

            with torch.autocast(device_type="cuda", dtype=torch.float16):
                loss = model(**batch).loss / args.gradient_accumulation_steps
            scaler.scale(loss).backward()
            global_step += 1

            if global_step % args.gradient_accumulation_steps == 0:
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(trainable, args.max_grad_norm)
                scaler.step(optimizer)
                scaler.update()
                optimizer.zero_grad(set_to_none=True)
                optimizer_steps += 1

            if global_step % args.log_steps == 0:
                used_gb = torch.cuda.max_memory_allocated() / 1024**3
                print(
                    json.dumps(
                        {
                            "epoch": epoch + 1,
                            "record": record_index,
                            "globalStep": global_step,
                            "optimizerSteps": optimizer_steps,
                            "loss": float(loss.detach().cpu())
                            * args.gradient_accumulation_steps,
                            "maxGpuMemoryGb": round(used_gb, 3),
                        },
                        ensure_ascii=False,
                    )
                )

            if (
                args.save_steps > 0
                and optimizer_steps > 0
                and optimizer_steps % args.save_steps == 0
            ):
                checkpoint = output_dir / f"checkpoint-{optimizer_steps}"
                model.save_pretrained(checkpoint)
                processor.save_pretrained(checkpoint)

        remainder = global_step % args.gradient_accumulation_steps
        if remainder:
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(trainable, args.max_grad_norm)
            scaler.step(optimizer)
            scaler.update()
            optimizer.zero_grad(set_to_none=True)
            optimizer_steps += 1

        eval_report = evaluate_loss(
            model,
            processor,
            val_records,
            device,
            args.max_length,
            args.eval_records,
            args.ocr_text_chars,
            args.max_ocr_blocks,
            args.alias_ocr_ids,
        )
        print(json.dumps({"epoch": epoch + 1, "eval": eval_report}, ensure_ascii=False))

    model.save_pretrained(output_dir)
    processor.save_pretrained(output_dir)
    elapsed = time.time() - started
    report = {
        "status": "completed",
        "outputDir": str(output_dir),
        "globalSteps": global_step,
        "optimizerSteps": optimizer_steps,
        "skippedRecords": skipped,
        "elapsedSec": round(elapsed, 3),
        "maxGpuMemoryGb": round(torch.cuda.max_memory_allocated() / 1024**3, 3),
    }
    write_json(output_dir / "train_report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--train", default=str(DEFAULT_TRAIN))
    parser.add_argument("--val", default=str(DEFAULT_VAL))
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--gradient-accumulation-steps", type=int, default=8)
    parser.add_argument("--max-grad-norm", type=float, default=1.0)
    parser.add_argument("--lora-r", type=int, default=16)
    parser.add_argument("--lora-alpha", type=int, default=32)
    parser.add_argument("--lora-dropout", type=float, default=0.05)
    parser.add_argument("--min-pixels", type=int, default=200704)
    parser.add_argument("--max-pixels", type=int, default=200704)
    parser.add_argument("--max-length", type=int, default=2048)
    parser.add_argument(
        "--ocr-text-chars",
        type=int,
        default=0,
        help="Optional per-OCR-block text truncation before tokenization. 0 keeps full text.",
    )
    parser.add_argument(
        "--max-ocr-blocks",
        type=int,
        default=0,
        help="Optional cap on OCR blocks in the user prompt. 0 keeps all blocks.",
    )
    parser.add_argument(
        "--alias-ocr-ids",
        action="store_true",
        help="Replace long OCR ids with b0/b1 aliases in both prompt and target.",
    )
    parser.add_argument("--max-train-samples", type=int, default=0)
    parser.add_argument("--max-val-samples", type=int, default=8)
    parser.add_argument("--eval-records", type=int, default=2)
    parser.add_argument("--log-steps", type=int, default=1)
    parser.add_argument("--save-steps", type=int, default=0)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--attn-implementation", default="sdpa", choices=("sdpa", "eager")
    )
    args = parser.parse_args()
    train(args)


if __name__ == "__main__":
    main()
