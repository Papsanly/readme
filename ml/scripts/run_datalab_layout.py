#!/usr/bin/env python3
"""Run datalab.to Marker for rendered distillation pages.

Input:  `ml/data/visual_queue_300.jsonl` produced by
        `prepare_distillation_dataset.py`.
Output: per-page layout JSON files in `ml/data/datalab/` and an enriched queue
        `ml/data/visual_queue_with_datalab.jsonl`.

The script loads `EXPO_PUBLIC_DATALAB_API_KEY` from the process environment or
from `.env` without printing the secret.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "ml" / "data"
QUEUE_PATH = DATA_DIR / "visual_queue_300.jsonl"
ENRICHED_QUEUE_PATH = DATA_DIR / "visual_queue_with_datalab.jsonl"
DATALAB_DIR = DATA_DIR / "datalab"
ERRORS_PATH = DATA_DIR / "datalab_errors.jsonl"

DEFAULT_BASE_URL = "https://www.datalab.to"
MARKER_PATH = "/api/v1/marker"
DEFAULT_POLL_INTERVAL_SEC = 2.0
DEFAULT_MAX_POLLS = 300
DEFAULT_TIMEOUT_SEC = 300
ERROR_PREVIEW = 600
USER_AGENT = "Mozilla/5.0 (compatible; ReadMeDistillation/1.0; +https://github.com/papsanly/readme)"


def load_dotenv() -> None:
    env_path = PROJECT_ROOT / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def get_api_key() -> str:
    load_dotenv()
    value = os.environ.get("EXPO_PUBLIC_DATALAB_API_KEY") or os.environ.get(
        "DATALAB_API_KEY"
    )
    if not value:
        raise RuntimeError(
            "Set EXPO_PUBLIC_DATALAB_API_KEY or DATALAB_API_KEY in .env/environment"
        )
    return value


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")


def append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def is_object(value: Any) -> bool:
    return isinstance(value, dict)


def strip_html(html: str) -> str:
    text = re.sub(r"<[^>]*>", " ", html)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    return re.sub(r"\s+", " ", text).strip()


def coerce_polygon(raw: Any) -> list[list[float]] | None:
    if not isinstance(raw, list):
        return None
    out: list[list[float]] = []
    for pt in raw:
        if (
            isinstance(pt, list)
            and len(pt) >= 2
            and isinstance(pt[0], (int, float))
            and isinstance(pt[1], (int, float))
        ):
            out.append([float(pt[0]), float(pt[1])])
    return out if len(out) >= 3 else None


def coerce_bbox(raw: Any) -> list[float] | None:
    if (
        isinstance(raw, list)
        and len(raw) >= 4
        and all(isinstance(v, (int, float)) for v in raw[:4])
    ):
        return [float(raw[0]), float(raw[1]), float(raw[2]), float(raw[3])]
    return None


def bbox_from_polygon(poly: list[list[float]]) -> list[float]:
    xs = [pt[0] for pt in poly]
    ys = [pt[1] for pt in poly]
    return [min(xs), min(ys), max(xs), max(ys)]


def extract_text(node: dict[str, Any]) -> str:
    html = node.get("html")
    if isinstance(html, str) and html:
        return strip_html(html)
    text = node.get("text")
    if isinstance(text, str) and text:
        return re.sub(r"\s+", " ", text).strip()
    children = node.get("children")
    if isinstance(children, list):
        parts = [extract_text(child) for child in children if isinstance(child, dict)]
        return re.sub(r"\s+", " ", " ".join(part for part in parts if part)).strip()
    return ""


def walk_page_blocks(node: Any, page_index: int, out: list[dict[str, Any]]) -> None:
    if not isinstance(node, dict):
        return
    label = (
        node.get("block_type") if isinstance(node.get("block_type"), str) else "Unknown"
    )
    polygon = coerce_polygon(node.get("polygon"))
    children = node.get("children") if isinstance(node.get("children"), list) else []

    has_spatial_children = any(
        isinstance(child, dict) and coerce_polygon(child.get("polygon"))
        for child in children
    )
    if has_spatial_children:
        before = len(out)
        for child in children:
            walk_page_blocks(child, page_index, out)
        if len(out) > before:
            return

    if polygon:
        bbox = coerce_bbox(node.get("bbox")) or bbox_from_polygon(polygon)
        out.append(
            {
                "pageIndex": page_index,
                "label": label,
                "text": extract_text(node),
                "polygon": polygon,
                "bbox": bbox,
            }
        )


def parse_marker_json(
    raw_json: Any, record_id: str, fallback_page_number: int
) -> dict[str, Any]:
    if not isinstance(raw_json, dict):
        raise RuntimeError("Marker response is not an object")
    root: Any = raw_json
    if isinstance(raw_json.get("json"), dict):
        root = raw_json["json"]
    elif isinstance(raw_json.get("document"), dict):
        root = raw_json["document"]

    if not isinstance(root, dict):
        raise RuntimeError("Marker response has no document root")

    page_nodes: list[Any] = []
    children = root.get("children")
    if isinstance(children, list):
        page_nodes.extend(
            child
            for child in children
            if isinstance(child, dict) and child.get("block_type") == "Page"
        )
    pages = root.get("pages")
    if not page_nodes and isinstance(pages, list):
        page_nodes.extend(pages)
    if not page_nodes and root.get("block_type") == "Page":
        page_nodes.append(root)
    if not page_nodes:
        raise RuntimeError("Marker response contains no Page nodes")

    node = page_nodes[0]
    if not isinstance(node, dict):
        raise RuntimeError("First page node is invalid")
    page_index = fallback_page_number
    polygon = coerce_polygon(node.get("polygon"))
    bbox = bbox_from_polygon(polygon) if polygon else coerce_bbox(node.get("bbox"))
    width = bbox[2] - bbox[0] if bbox else 0
    height = bbox[3] - bbox[1] if bbox else 0
    blocks: list[dict[str, Any]] = []
    node_children = node.get("children")
    if isinstance(node_children, list):
        for child in node_children:
            walk_page_blocks(child, page_index, blocks)

    for idx, block in enumerate(blocks):
        block["id"] = f"ocr_{record_id}_{idx:03d}"

    return {"pageIndex": page_index, "width": width, "height": height, "blocks": blocks}


def multipart_form_data(
    fields: dict[str, str], file_field: str, file_path: Path
) -> tuple[bytes, str]:
    boundary = f"----readme-datalab-{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for key, value in fields.items():
        chunks.append(f"--{boundary}\r\n".encode())
        chunks.append(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode())
        chunks.append(value.encode())
        chunks.append(b"\r\n")

    mime = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    chunks.append(f"--{boundary}\r\n".encode())
    chunks.append(
        f'Content-Disposition: form-data; name="{file_field}"; filename="{file_path.name}"\r\n'.encode()
    )
    chunks.append(f"Content-Type: {mime}\r\n\r\n".encode())
    chunks.append(file_path.read_bytes())
    chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), boundary


def request_json(req: urllib.request.Request, timeout_sec: int) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {body[:ERROR_PREVIEW]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error: {exc}") from exc
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Non-JSON response: {body[:ERROR_PREVIEW]}") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("JSON response is not an object")
    return parsed


def submit_marker(
    file_path: Path, api_key: str, base_url: str, timeout_sec: int
) -> dict[str, Any]:
    body, boundary = multipart_form_data(
        {
            "output_format": "json",
            "use_llm": "false",
            "force_ocr": "true",
            "strip_existing_ocr": "false",
            "paginate": "true",
        },
        "file",
        file_path,
    )
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}{MARKER_PATH}",
        data=body,
        method="POST",
        headers={
            "X-Api-Key": api_key,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    return request_json(req, timeout_sec)


def check_marker(check_url: str, api_key: str, timeout_sec: int) -> dict[str, Any]:
    req = urllib.request.Request(
        check_url,
        method="GET",
        headers={
            "X-Api-Key": api_key,
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    return request_json(req, timeout_sec)


def run_marker_for_page(
    file_path: Path,
    api_key: str,
    base_url: str,
    timeout_sec: int,
    poll_interval_sec: float,
    max_polls: int,
) -> dict[str, Any]:
    submit = submit_marker(file_path, api_key, base_url, timeout_sec)
    check_url = submit.get("request_check_url")
    if not isinstance(check_url, str) or not check_url:
        raise RuntimeError(
            f"Marker submit missing request_check_url: {json.dumps(submit)[:ERROR_PREVIEW]}"
        )

    for _ in range(max_polls):
        time.sleep(poll_interval_sec)
        status = check_marker(check_url, api_key, timeout_sec)
        if status.get("status") == "complete":
            if status.get("success") is False:
                raise RuntimeError(f"Marker job failed: {status.get('error')}")
            return status
    raise RuntimeError(f"Marker did not complete within {max_polls} polls")


def enrich_record(record: dict[str, Any], layout: dict[str, Any]) -> dict[str, Any]:
    ocr_blocks = [
        {
            "id": block["id"],
            "label": block.get("label", "Unknown"),
            "text": block.get("text", ""),
        }
        for block in layout.get("blocks", [])
    ]
    enriched = dict(record)
    enriched["ocrBlocks"] = ocr_blocks
    enriched["ocrLayoutPath"] = str(
        (DATALAB_DIR / f"{record['id']}.json").relative_to(PROJECT_ROOT)
    ).replace("\\", "/")
    enriched["annotation"] = {
        **record.get("annotation", {}),
        "status": "pending_visual_annotation_with_datalab",
        "source": "visual-teacher-required",
        "notes": "Teacher must inspect PNG and use DataLab blocks only as layout/OCR hints. Do not copy DataLab text blindly.",
    }
    return enriched


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--limit", type=int, default=0, help="Process at most N records; 0 means all."
    )
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument(
        "--poll-interval-sec", type=float, default=DEFAULT_POLL_INTERVAL_SEC
    )
    parser.add_argument("--max-polls", type=int, default=DEFAULT_MAX_POLLS)
    parser.add_argument("--timeout-sec", type=int, default=DEFAULT_TIMEOUT_SEC)
    args = parser.parse_args()

    api_key = get_api_key()
    if not QUEUE_PATH.exists():
        raise RuntimeError(
            f"Missing queue file: {QUEUE_PATH}. Run prepare_distillation_dataset.py first."
        )

    DATALAB_DIR.mkdir(parents=True, exist_ok=True)
    records = read_jsonl(QUEUE_PATH)
    processed = 0
    attempted = 0
    repeated_infra_failures = 0
    enriched_records: list[dict[str, Any]] = []

    for index, record in enumerate(records, start=1):
        layout_path = DATALAB_DIR / f"{record['id']}.json"
        image_path = PROJECT_ROOT / record["imagePath"]
        if layout_path.exists() and not args.force:
            layout = json.loads(layout_path.read_text(encoding="utf-8"))
            enriched_records.append(enrich_record(record, layout))
            continue
        if args.limit and attempted >= args.limit:
            enriched_records.append(record)
            continue

        attempted += 1
        print(
            f"[datalab] {index}/{len(records)} {record['id']} -> {record['imagePath']}"
        )
        try:
            raw = run_marker_for_page(
                image_path,
                api_key,
                args.base_url,
                args.timeout_sec,
                args.poll_interval_sec,
                args.max_polls,
            )
            layout = parse_marker_json(raw, record["id"], record["pageNumber"])
            layout["recordId"] = record["id"]
            layout["imagePath"] = record["imagePath"]
            layout["rawStatusKeys"] = sorted(raw.keys())
            layout_path.write_text(
                json.dumps(layout, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            enriched_records.append(enrich_record(record, layout))
            processed += 1
        except Exception as exc:  # noqa: BLE001 - keep batch running and record the failure.
            message = str(exc)
            print(f"[datalab] ERROR {record['id']}: {message[:ERROR_PREVIEW]}")
            if "HTTP 403" in message or "error code: 1010" in message:
                repeated_infra_failures += 1
            else:
                repeated_infra_failures = 0
            append_jsonl(
                ERRORS_PATH,
                {
                    "id": record["id"],
                    "imagePath": record["imagePath"],
                    "error": message,
                },
            )
            failed = dict(record)
            failed["annotation"] = {
                **record.get("annotation", {}),
                "status": "datalab_failed",
                "error": message,
            }
            enriched_records.append(failed)
            if repeated_infra_failures >= 3:
                print(
                    "[datalab] stopping early after 3 repeated infrastructure/Cloudflare failures"
                )
                enriched_records.extend(records[index:])
                break

    write_jsonl(ENRICHED_QUEUE_PATH, enriched_records)
    write_jsonl(DATA_DIR / "dataset" / "all.jsonl", enriched_records)
    for split in ("train", "val", "test"):
        write_jsonl(
            DATA_DIR / "dataset" / f"{split}.jsonl",
            [r for r in enriched_records if r.get("split") == split],
        )

    ok = sum(1 for r in enriched_records if r.get("ocrLayoutPath"))
    print(f"[datalab] enriched records with layout: {ok}/{len(enriched_records)}")
    print(f"[datalab] queue: {ENRICHED_QUEUE_PATH.relative_to(PROJECT_ROOT)}")


if __name__ == "__main__":
    main()
