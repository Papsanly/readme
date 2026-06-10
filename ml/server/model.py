#!/usr/bin/env python3
"""Student VLM backends used by the FastAPI inference server.

The production backend is a lazy Qwen2.5-VL + optional LoRA adapter runner. A
small OCR-only stub is also provided for endpoint smoke tests; it is not a
quality baseline and should not be reported as the distilled model.
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import threading
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any

from .schemas import VlmAnalyzePageRequest, VlmBlock, VlmPageResult

SYSTEM_PROMPT = (
    "You are an OCR + TTS-normalization assistant for an audiobook generator. "
    "Inspect the page image and OCR layout hints. Return only compact, strict JSON "
    "matching VlmPageResult: {blocks, pageLanguage}. Escape line breaks inside "
    "string values as \\n. Allowed block keys are type, text, rawText, caption, "
    "isFigure, isMainContent, level, and ocrBlockIds. Do not add markdown, "
    "explanations, duplicate blocks, or rawTextInvisible fields."
)

DEFAULT_MODEL_ID = "Qwen/Qwen2.5-VL-3B-Instruct"
SERVICE_TYPES = {"page-number", "footnote", "header-footer", "toc", "service"}
TYPE_ALIASES = {
    "body": "paragraph",
    "body_text": "paragraph",
    "body-text": "paragraph",
    "text": "paragraph",
    "title": "heading",
    "subtitle": "heading",
    "section": "heading",
    "section_header": "heading",
    "section-header": "heading",
    "image": "figure",
    "picture": "figure",
    "diagram": "figure",
    "chart": "figure",
    "table": "figure",
    "page_number": "page-number",
    "page-number": "page-number",
    "footer": "header-footer",
    "header": "header-footer",
    "header_footer": "header-footer",
    "header-footer": "header-footer",
    "contents": "toc",
    "table_of_contents": "toc",
    "table-of-contents": "toc",
}


class StudentModelError(RuntimeError):
    """Raised when student model loading or inference fails."""


@dataclass(frozen=True)
class StudentMetadata:
    mode: str
    model: str | None = None
    adapter: str | None = None


def env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().casefold() in {"1", "true", "yes", "on"}


def model_to_dict(value: Any) -> Any:
    """Return a JSON-serializable dict for Pydantic v1 or v2 models."""

    if hasattr(value, "model_dump"):
        return value.model_dump(exclude_none=True)
    if hasattr(value, "dict"):
        return value.dict(exclude_none=True)
    return value


def compact_ocr_blocks(
    blocks: list[Any], text_chars: int, max_blocks: int, alias_ids: bool
) -> tuple[list[Any], dict[str, str]]:
    """Compact OCR hints and optionally alias long OCR ids.

    Returns compacted blocks and an alias-to-original map for output restoration.
    """

    selected = blocks[:max_blocks] if max_blocks > 0 else blocks
    out: list[Any] = []
    alias_to_original: dict[str, str] = {}
    for index, raw_block in enumerate(selected):
        block = model_to_dict(raw_block)
        if not isinstance(block, dict):
            out.append(block)
            continue
        item = dict(block)
        original_id = item.get("id")
        if alias_ids and isinstance(original_id, str) and original_id:
            alias = f"b{index}"
            alias_to_original[alias] = original_id
            item["id"] = alias
        text = item.get("text")
        if text_chars > 0 and isinstance(text, str) and len(text) > text_chars:
            item["text"] = text[:text_chars].rstrip() + "…"
        out.append(item)
    return out, alias_to_original


def normalize_for_similarity(text: str) -> str:
    text = text.casefold()
    text = re.sub(r"[^\w\s]+", " ", text, flags=re.UNICODE)
    return " ".join(text.split())


def token_jaccard(left: str, right: str) -> float:
    a = set(normalize_for_similarity(left).split())
    b = set(normalize_for_similarity(right).split())
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def text_similarity(left: str, right: str) -> float:
    a = normalize_for_similarity(left)
    b = normalize_for_similarity(right)
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return max(SequenceMatcher(None, a, b).ratio(), token_jaccard(a, b))


def prefer_block(candidate: VlmBlock, existing: VlmBlock) -> bool:
    """Return true when candidate should replace an already-kept duplicate."""

    if existing.type == "unknown" and candidate.type != "unknown":
        return True
    if existing.type in SERVICE_TYPES and candidate.type not in SERVICE_TYPES:
        return True
    if existing.isFigure and not candidate.isFigure:
        return False
    if candidate.isFigure and not existing.isFigure:
        return True
    return len(candidate.text) > len(existing.text) * 1.15


def dedupe_blocks(result: VlmPageResult) -> VlmPageResult:
    """Drop repeated narration blocks from imperfect student generations.

    The student sometimes emits both a figure-style cover description and a
    paragraph that repeats the same description. The app reads all returned
    blocks, so duplicates become audible. This conservative pass removes only
    high-overlap duplicates and keeps OCR ids unique.
    """

    kept: list[VlmBlock] = []
    used_ocr_ids: set[str] = set()
    for block in result.blocks:
        block_ids = set(block.ocrBlockIds)
        duplicate_index: int | None = None
        for index, existing in enumerate(kept):
            existing_ids = set(existing.ocrBlockIds)
            shared_ocr = bool(block_ids and existing_ids and block_ids & existing_ids)
            similar = text_similarity(block.text, existing.text)
            if shared_ocr or similar >= 0.72:
                duplicate_index = index
                break
            # Cover/page summaries often repeat the same semantic description
            # with different opening words. Treat very similar adjacent main
            # blocks as duplicates even with different OCR ids.
            if (
                index == len(kept) - 1
                and block.isMainContent
                and existing.isMainContent
                and similar >= 0.58
                and min(len(block.text), len(existing.text)) >= 80
            ):
                duplicate_index = index
                break

        if duplicate_index is None:
            block.ocrBlockIds = [
                oid for oid in block.ocrBlockIds if oid not in used_ocr_ids
            ]
            used_ocr_ids.update(block.ocrBlockIds)
            kept.append(block)
            continue

        existing = kept[duplicate_index]
        if prefer_block(block, existing):
            released_ids = set(existing.ocrBlockIds)
            used_ocr_ids.difference_update(released_ids)
            block.ocrBlockIds = [
                oid for oid in block.ocrBlockIds if oid not in used_ocr_ids
            ]
            used_ocr_ids.update(block.ocrBlockIds)
            kept[duplicate_index] = block

    result.blocks = kept
    return result


def restore_ocr_aliases(
    result: VlmPageResult,
    alias_to_original: dict[str, str],
    valid_original_ids: set[str] | None = None,
) -> VlmPageResult:
    seen: set[str] = set()
    for block in result.blocks:
        restored: list[str] = []
        for oid in block.ocrBlockIds:
            original = alias_to_original.get(oid, oid)
            if valid_original_ids is not None and original not in valid_original_ids:
                continue
            if original in seen:
                continue
            seen.add(original)
            restored.append(original)
        block.ocrBlockIds = restored
    return dedupe_blocks(result)


def decode_page_image(request: VlmAnalyzePageRequest) -> Any:
    """Decode the request image into a PIL Image without importing PIL globally."""

    try:
        from PIL import Image
    except ImportError as exc:  # pragma: no cover - depends on local environment
        raise StudentModelError(
            "Pillow is required for real student inference"
        ) from exc

    try:
        raw = base64.b64decode(request.imageBase64, validate=True)
    except Exception as exc:  # noqa: BLE001 - include bad-base64 context
        raise StudentModelError("imageBase64 is not valid base64") from exc

    try:
        return Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:  # noqa: BLE001 - Pillow reports many image errors
        raise StudentModelError("imageBase64 could not be decoded as an image") from exc


def json_control_escape_suffix(char: str) -> str:
    if char == "\n":
        return "n"
    if char == "\r":
        return "r"
    if char == "\t":
        return "t"
    return f"u{ord(char):04x}"


def escape_json_control_chars_in_strings(source: str) -> str:
    """Escape bare control characters inside JSON strings.

    Small VLMs sometimes emit visually JSON-shaped text with literal newlines in
    `rawText`/`text` values instead of escaped `\\n`. Python's strict JSON
    parser rejects those strings even though the rest of the response is usable.
    """

    out: list[str] = []
    in_string = False
    escaped = False
    for char in source:
        if not in_string:
            out.append(char)
            if char == '"':
                in_string = True
            continue

        if escaped:
            if ord(char) < 0x20:
                out.append(json_control_escape_suffix(char))
            else:
                out.append(char)
            escaped = False
            continue

        if char == "\\":
            out.append(char)
            escaped = True
        elif char == '"':
            out.append(char)
            in_string = False
        elif ord(char) < 0x20:
            out.append("\\" + json_control_escape_suffix(char))
        else:
            out.append(char)

    return "".join(out)


def compact_model_output_preview(text: str, limit: int = 900) -> str:
    escaped = text.replace("\r", "\\r").replace("\n", "\\n")
    if len(escaped) <= limit:
        return escaped
    half = max(1, limit // 2)
    return f"{escaped[:half]} … {escaped[-half:]}"


def parse_json_object_candidate(candidate: str) -> dict[str, Any]:
    attempts = [candidate]
    repaired = escape_json_control_chars_in_strings(candidate)
    if repaired != candidate:
        attempts.append(repaired)

    last_error: json.JSONDecodeError | None = None
    for attempt in attempts:
        try:
            payload = json.loads(attempt)
        except json.JSONDecodeError as exc:
            last_error = exc
            continue
        if not isinstance(payload, dict):
            raise StudentModelError("model JSON response must be an object")
        return payload

    partial = extract_partial_page_payload(repaired)
    if partial is not None:
        return partial

    if last_error is not None:
        raise last_error
    raise json.JSONDecodeError("unknown JSON parse failure", candidate, 0)


def extract_json_string_value(source: str, key: str) -> str | None:
    match = re.search(
        rf'"{re.escape(key)}"\s*:\s*"((?:\\.|[^"\\])*)"',
        source,
        flags=re.DOTALL,
    )
    if not match:
        return None
    raw_value = match.group(1)
    try:
        value = json.loads('"' + raw_value + '"')
    except json.JSONDecodeError:
        return raw_value
    return value if isinstance(value, str) else None


def iter_complete_json_objects(source: str, start_index: int) -> list[str]:
    objects: list[str] = []
    object_start: int | None = None
    depth = 0
    in_string = False
    escaped = False

    for index in range(start_index, len(source)):
        char = source[index]
        if object_start is None:
            if char == "]":
                break
            if char == "{":
                object_start = index
                depth = 1
                in_string = False
                escaped = False
            continue

        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                objects.append(source[object_start : index + 1])
                object_start = None

    return objects


def extract_partial_page_payload(source: str) -> dict[str, Any] | None:
    """Recover complete block objects from a response truncated mid-JSON.

    This is intentionally conservative: it only returns a payload when the
    top-level `blocks` array has at least one fully closed object. The caller's
    normal schema normalization still validates each recovered block.
    """

    blocks_match = re.search(r'"blocks"\s*:\s*\[', source)
    if not blocks_match:
        return None

    blocks: list[dict[str, Any]] = []
    for raw_block in iter_complete_json_objects(source, blocks_match.end()):
        try:
            block = parse_json_object_candidate(raw_block)
        except (json.JSONDecodeError, StudentModelError):
            continue
        if isinstance(block, dict):
            blocks.append(block)

    if not blocks:
        return None

    payload: dict[str, Any] = {"blocks": blocks}
    page_language = extract_json_string_value(source, "pageLanguage")
    if page_language:
        payload["pageLanguage"] = page_language
    print(
        "[student-vlm] recovered partial JSON response "
        f"with {len(blocks)} complete block(s); generation was likely truncated"
    )
    return payload


def extract_json_payload(text: str) -> dict[str, Any]:
    """Extract the first JSON object from model text output."""

    stripped = text.strip()
    if not stripped:
        raise StudentModelError("model returned an empty response")

    fenced = re.search(r"```(?:json)?\s*(.*?)\s*```", stripped, flags=re.DOTALL)
    if fenced:
        stripped = fenced.group(1).strip()

    if not stripped.startswith("{"):
        first = stripped.find("{")
        if first >= 0:
            stripped = stripped[first:]

    depth = 0
    in_string = False
    escaped = False
    end_index: int | None = None
    for index, char in enumerate(stripped):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                end_index = index + 1
                break

    if end_index is not None:
        stripped = stripped[:end_index]

    try:
        payload = parse_json_object_candidate(stripped)
    except json.JSONDecodeError as exc:
        preview = compact_model_output_preview(text)
        raise StudentModelError(
            "model response did not contain valid JSON "
            f"({exc.msg} at line {exc.lineno}, column {exc.colno}): {preview}"
        ) from exc

    if not isinstance(payload, dict):
        raise StudentModelError("model JSON response must be an object")
    return payload


def normalize_block_type(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        return "unknown"
    normalized = value.strip().casefold().replace(" ", "_")
    return TYPE_ALIASES.get(normalized, value.strip())


def normalize_model_payload(payload: dict[str, Any]) -> dict[str, Any]:
    blocks = payload.get("blocks")
    if not isinstance(blocks, list):
        return payload

    normalized_blocks: list[dict[str, Any]] = []
    for raw_block in blocks:
        if not isinstance(raw_block, dict):
            continue
        block = dict(raw_block)
        block_type = normalize_block_type(block.get("type"))
        block["type"] = (
            block_type
            if block_type in TYPE_ALIASES.values()
            or block_type in SERVICE_TYPES
            or block_type
            in {"heading", "paragraph", "list", "quote", "caption", "figure", "unknown"}
            else "unknown"
        )

        text = block.get("text")
        if not isinstance(text, str) or not text.strip():
            fallback = block.get("rawText") or block.get("caption") or "Unknown block."
            block["text"] = str(fallback)

        if not isinstance(block.get("isFigure"), bool):
            block["isFigure"] = block["type"] == "figure"
        if block["type"] == "figure":
            block["isFigure"] = True
        elif block.get("isFigure") is True:
            block["isFigure"] = False

        if not isinstance(block.get("isMainContent"), bool):
            block["isMainContent"] = block["type"] not in SERVICE_TYPES

        if block.get("level") not in (1, 2):
            block.pop("level", None)

        ocr_ids = block.get("ocrBlockIds")
        if not isinstance(ocr_ids, list):
            block["ocrBlockIds"] = []
        else:
            block["ocrBlockIds"] = [v for v in ocr_ids if isinstance(v, str) and v]

        normalized_blocks.append(block)

    payload["blocks"] = normalized_blocks
    return payload


def parse_model_output(text: str) -> VlmPageResult:
    payload = normalize_model_payload(extract_json_payload(text))
    try:
        return VlmPageResult(**payload)
    except Exception as exc:  # noqa: BLE001 - Pydantic v1/v2 raise different classes
        raise StudentModelError(
            f"model JSON does not match VlmPageResult after normalization: {exc}"
        ) from exc


class StudentBackend:
    metadata: StudentMetadata

    def analyze(self, request: VlmAnalyzePageRequest) -> VlmPageResult:
        raise NotImplementedError


class StubStudentBackend(StudentBackend):
    """Deterministic OCR-only contract stub for local endpoint smoke tests."""

    metadata = StudentMetadata(mode="stub", model="ocr-contract-stub")

    def analyze(self, request: VlmAnalyzePageRequest) -> VlmPageResult:
        language = request.context.language or self._infer_language(request)
        blocks: list[VlmBlock] = []
        for index, ocr in enumerate(request.ocrBlocks):
            raw_text = " ".join(ocr.text.split())
            if not raw_text:
                continue
            block_type = self._block_type(ocr.label, raw_text)
            is_figure = block_type == "figure"
            is_main = block_type not in {
                "page-number",
                "header-footer",
                "toc",
                "service",
            }
            level = (
                1
                if block_type == "heading" and index == 0
                else 2
                if block_type == "heading"
                else None
            )
            blocks.append(
                VlmBlock(
                    type=block_type,
                    text=raw_text,
                    rawText=raw_text,
                    isFigure=is_figure,
                    isMainContent=is_main,
                    level=level,
                    ocrBlockIds=[ocr.id],
                )
            )

        if not blocks:
            blocks.append(
                VlmBlock(
                    type="unknown",
                    text="No readable text detected on this page.",
                    isFigure=False,
                    isMainContent=False,
                    ocrBlockIds=[],
                )
            )
        return VlmPageResult(pageLanguage=language, blocks=blocks)

    @staticmethod
    def _infer_language(request: VlmAnalyzePageRequest) -> str:
        text = " ".join(block.text for block in request.ocrBlocks)
        if re.search(r"[А-Яа-яЁёІіЇїЄєҐґ]", text):
            return "Russian"
        return "English"

    @staticmethod
    def _block_type(label: str, text: str) -> str:
        label_lower = label.casefold()
        text_lower = text.casefold()
        if (
            "picture" in label_lower
            or "figure" in label_lower
            or "table" in label_lower
        ):
            return "figure"
        if "header" in label_lower and "section" not in label_lower:
            return "header-footer"
        if "footer" in label_lower:
            return "page-number" if len(text) <= 12 else "header-footer"
        if "section" in label_lower or "title" in label_lower:
            return "toc" if "contents" in text_lower else "heading"
        return "paragraph"


class Qwen25VlLoraBackend(StudentBackend):
    """Qwen2.5-VL inference backend with optional PEFT LoRA adapter."""

    def __init__(
        self,
        model_id: str = DEFAULT_MODEL_ID,
        adapter_path: str | None = None,
        max_new_tokens: int = 6144,
    ) -> None:
        self.metadata = StudentMetadata(
            mode="qwen2.5-vl-lora", model=model_id, adapter=adapter_path
        )
        self.model_id = model_id
        self.adapter_path = adapter_path
        self.max_new_tokens = max_new_tokens
        self.processor: Any | None = None
        self.model: Any | None = None
        self.process_vision_info: Any | None = None
        self.load_lock = threading.Lock()
        self.inference_lock = threading.Lock()

    def analyze(self, request: VlmAnalyzePageRequest) -> VlmPageResult:
        self._ensure_loaded()
        assert self.processor is not None
        assert self.model is not None
        assert self.process_vision_info is not None

        # Qwen2.5-VL generation is GPU-memory heavy. React Native can dispatch
        # several page analyses at once, but a 12 GB local GPU should process
        # them one-by-one instead of running concurrent generate() calls.
        with self.inference_lock:
            return self._analyze_locked(request)

    def _analyze_locked(self, request: VlmAnalyzePageRequest) -> VlmPageResult:
        assert self.processor is not None
        assert self.model is not None
        assert self.process_vision_info is not None

        image = decode_page_image(request)
        ocr_text_chars = int(os.getenv("READ_ME_OCR_TEXT_CHARS", "180"))
        max_ocr_blocks = int(os.getenv("READ_ME_MAX_OCR_BLOCKS", "64"))
        alias_ocr_ids = env_flag("READ_ME_ALIAS_OCR_IDS", default=True)
        request_ocr_blocks = list(request.ocrBlocks)
        valid_original_ids = {block.id for block in request_ocr_blocks}
        compact_blocks, alias_to_original = compact_ocr_blocks(
            request_ocr_blocks, ocr_text_chars, max_ocr_blocks, alias_ocr_ids
        )
        user_payload = {
            "pageNumber": request.pageNumber,
            "totalPages": request.totalPages,
            "context": model_to_dict(request.context),
            "ocrBlocks": compact_blocks,
        }
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image},
                    {
                        "type": "text",
                        "text": "Page image plus OCR layout hints. Return only JSON.\n"
                        + json.dumps(user_payload, ensure_ascii=False),
                    },
                ],
            },
        ]

        prompt = self.processor.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        image_inputs, video_inputs = self.process_vision_info(messages)
        inputs = self.processor(
            text=[prompt],
            images=image_inputs,
            videos=video_inputs,
            padding=True,
            return_tensors="pt",
        )
        inputs = inputs.to(self._model_device())

        generated_ids = self.model.generate(
            **inputs, max_new_tokens=self.max_new_tokens, do_sample=False
        )
        generated_trimmed = [
            output_ids[len(input_ids) :]
            for input_ids, output_ids in zip(inputs.input_ids, generated_ids)
        ]
        generated_token_count = int(generated_trimmed[0].numel())
        if generated_token_count >= self.max_new_tokens:
            print(
                "[student-vlm] generation reached READ_ME_MAX_NEW_TOKENS="
                f"{self.max_new_tokens}; response may be truncated"
            )
        decoded = self.processor.batch_decode(
            generated_trimmed,
            skip_special_tokens=True,
            clean_up_tokenization_spaces=False,
        )[0]
        try:
            return restore_ocr_aliases(
                parse_model_output(decoded), alias_to_original, valid_original_ids
            )
        except StudentModelError as exc:
            print(f"[student-vlm] falling back to OCR stub after parse failure: {exc}")
            return StubStudentBackend().analyze(request)

    def _ensure_loaded(self) -> None:
        if (
            self.model is not None
            and self.processor is not None
            and self.process_vision_info is not None
        ):
            return

        with self.load_lock:
            if (
                self.model is not None
                and self.processor is not None
                and self.process_vision_info is not None
            ):
                return

            try:
                import torch
                from qwen_vl_utils import process_vision_info
                from transformers import (
                    AutoProcessor,
                    Qwen2_5_VLForConditionalGeneration,
                )
            except (
                ImportError
            ) as exc:  # pragma: no cover - depends on local environment
                raise StudentModelError(
                    "Real student inference requires torch, transformers, qwen-vl-utils, and Pillow. "
                    "Install ml/server/requirements.txt or start with READ_ME_STUDENT_STUB=1."
                ) from exc

            dtype_name = os.getenv("READ_ME_TORCH_DTYPE", "fp16").casefold()
            if dtype_name == "bf16":
                torch_dtype: Any = torch.bfloat16
            elif dtype_name in {"fp16", "float16"}:
                torch_dtype = torch.float16
            elif dtype_name in {"fp32", "float32"}:
                torch_dtype = torch.float32
            else:
                torch_dtype = "auto"

            use_cuda = torch.cuda.is_available()
            model_kwargs: dict[str, Any] = {"torch_dtype": torch_dtype}
            device_map = os.getenv("READ_ME_DEVICE_MAP")
            if device_map:
                model_kwargs["device_map"] = device_map

            try:
                self.processor = AutoProcessor.from_pretrained(
                    self.model_id, trust_remote_code=True
                )
                self.model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
                    self.model_id,
                    trust_remote_code=True,
                    **model_kwargs,
                )
            except Exception as exc:  # noqa: BLE001 - HF loaders expose many errors
                raise StudentModelError(
                    f"failed to load base model {self.model_id}: {exc}"
                ) from exc

            if device_map is None:
                self.model.to(
                    "cuda" if use_cuda else os.getenv("READ_ME_DEVICE", "cpu")
                )

            if self.adapter_path:
                try:
                    from peft import PeftModel

                    self.model = PeftModel.from_pretrained(
                        self.model, self.adapter_path
                    )
                    if device_map is None:
                        self.model.to(
                            "cuda" if use_cuda else os.getenv("READ_ME_DEVICE", "cpu")
                        )
                except Exception as exc:  # noqa: BLE001
                    raise StudentModelError(
                        f"failed to load LoRA adapter {self.adapter_path}: {exc}"
                    ) from exc

            self.model.eval()
            self.process_vision_info = process_vision_info

    def _model_device(self) -> Any:
        assert self.model is not None
        try:
            return next(self.model.parameters()).device
        except Exception:  # noqa: BLE001 - PeftModel/device_map fallback
            return getattr(self.model, "device", "cpu")


def build_student_from_env() -> StudentBackend:
    if env_flag("READ_ME_STUDENT_STUB", default=False):
        return StubStudentBackend()
    return Qwen25VlLoraBackend(
        model_id=os.getenv("READ_ME_STUDENT_MODEL", DEFAULT_MODEL_ID),
        adapter_path=os.getenv("READ_ME_LORA_ADAPTER"),
        max_new_tokens=int(os.getenv("READ_ME_MAX_NEW_TOKENS", "6144")),
    )
