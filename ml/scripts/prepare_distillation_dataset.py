#!/usr/bin/env python3
"""Prepare image-only page queue for document-to-TTS VLM distillation.

This script deliberately does NOT use `pdftotext` or any PDF text layer to create
teacher targets. The teacher target for this project must be produced from the
rendered page image, following `src/pipeline/prompt.ts`.

Outputs:
- `ml/data/rendered/<document-id>/page_XXXX.png` — rendered page images;
- `ml/data/visual_queue_300.jsonl` — page-level annotation queue;
- `ml/data/dataset/all.jsonl` — dataset shell with pending visual annotations;
- `ml/data/manifest.json`, `ml/data/stats.json`, `ml/data/summary.md`.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import subprocess
import tempfile
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAW_PDF_DIR = PROJECT_ROOT / "data" / "raw-pdfs"
DATA_DIR = PROJECT_ROOT / "ml" / "data"
RENDERED_DIR = DATA_DIR / "rendered"
DATASET_DIR = DATA_DIR / "dataset"


@dataclass(frozen=True)
class PdfInfo:
    path: Path
    document_id: str
    title: str
    page_count: int


def run_command(
    args: list[str], timeout: int = 120
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=PROJECT_ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=True,
    )


def require_tool(name: str) -> None:
    if shutil.which(name) is None:
        raise RuntimeError(
            f"Required tool '{name}' was not found in PATH. Install Poppler and retry."
        )


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    ascii_value = re.sub(r"[^A-Za-z0-9]+", "-", ascii_value).strip("-").lower()
    if ascii_value:
        return ascii_value[:80]
    fallback = re.sub(r"\W+", "-", value, flags=re.UNICODE).strip("-").lower()
    return fallback[:80] or "document"


def get_pdf_page_count(pdf: Path) -> int:
    result = run_command(["pdfinfo", str(pdf)], timeout=30)
    for line in result.stdout.splitlines():
        if line.lower().startswith("pages:"):
            return int(line.split(":", 1)[1].strip())
    raise RuntimeError(f"Could not determine page count for {pdf}")


def discover_pdfs() -> list[PdfInfo]:
    pdfs = sorted(RAW_PDF_DIR.glob("*.pdf"), key=lambda p: p.name.lower())
    if not pdfs:
        raise RuntimeError(f"No PDFs found in {RAW_PDF_DIR}")
    infos: list[PdfInfo] = []
    seen: Counter[str] = Counter()
    for pdf in pdfs:
        base_slug = slugify(pdf.stem)
        seen[base_slug] += 1
        doc_id = base_slug if seen[base_slug] == 1 else f"{base_slug}-{seen[base_slug]}"
        infos.append(
            PdfInfo(
                path=pdf,
                document_id=doc_id,
                title=pdf.stem.replace("_", " "),
                page_count=get_pdf_page_count(pdf),
            )
        )
    return infos


def allocate_pages(infos: list[PdfInfo], target_pages: int) -> dict[str, int]:
    total_available = sum(info.page_count for info in infos)
    target = min(target_pages, total_available)
    raw_allocations = [target * info.page_count / total_available for info in infos]
    allocations = [
        max(1, min(info.page_count, int(math.floor(raw))))
        for info, raw in zip(infos, raw_allocations)
    ]

    while sum(allocations) < target:
        candidates = [
            (
                raw_allocations[i] - allocations[i],
                infos[i].page_count - allocations[i],
                i,
            )
            for i in range(len(infos))
            if allocations[i] < infos[i].page_count
        ]
        if not candidates:
            break
        _, _, idx = max(candidates)
        allocations[idx] += 1

    while sum(allocations) > target:
        candidates = [
            (allocations[i], i) for i in range(len(infos)) if allocations[i] > 1
        ]
        if not candidates:
            break
        _, idx = max(candidates)
        allocations[idx] -= 1

    return {info.document_id: allocations[i] for i, info in enumerate(infos)}


def sample_pages(page_count: int, requested: int) -> list[int]:
    if requested >= page_count:
        return list(range(1, page_count + 1))

    pages: set[int] = set()

    # Front matter is over-represented intentionally: it contains covers,
    # contents, copyright pages, headers, page numbers, and other service blocks.
    front_matter = min(12, max(4, requested // 5), page_count)
    pages.update(range(1, front_matter + 1))
    pages.add(page_count)

    # Add landmarks to cover body chapters across the full book.
    for ratio in (0.10, 0.20, 0.25, 0.33, 0.50, 0.66, 0.75, 0.90):
        pages.add(max(1, min(page_count, round(page_count * ratio))))

    # Fill the remaining quota with evenly spaced pages.
    i = 0
    while len(pages) < requested:
        candidate = 1 + round(i * (page_count - 1) / max(1, requested - 1))
        pages.add(max(1, min(page_count, candidate)))
        i += 1
        if i > requested * 20:
            for page in range(1, page_count + 1):
                pages.add(page)
                if len(pages) >= requested:
                    break
            break

    return sorted(pages)[:requested]


def render_page(pdf: Path, doc_id: str, page: int, dpi: int, force: bool) -> Path:
    doc_dir = RENDERED_DIR / doc_id
    doc_dir.mkdir(parents=True, exist_ok=True)
    image_path = doc_dir / f"page_{page:04d}.png"
    if image_path.exists() and not force:
        return image_path

    with tempfile.TemporaryDirectory() as tmp:
        prefix = Path(tmp) / f"{doc_id}_page_{page:04d}"
        run_command(
            [
                "pdftoppm",
                "-f",
                str(page),
                "-l",
                str(page),
                "-r",
                str(dpi),
                "-png",
                str(pdf),
                str(prefix),
            ],
            timeout=180,
        )
        rendered = sorted(Path(tmp).glob(f"{doc_id}_page_{page:04d}-*.png"))
        if not rendered:
            raise RuntimeError(f"pdftoppm did not render {pdf.name} page {page}")
        shutil.move(str(rendered[0]), image_path)
    return image_path


def assign_splits(records: list[dict[str, Any]]) -> None:
    by_doc: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        by_doc[record["documentId"]].append(record)
    for doc_records in by_doc.values():
        doc_records.sort(key=lambda r: r["pageNumber"])
        for idx, record in enumerate(doc_records):
            mod = idx % 10
            if mod == 0:
                split = "test"
            elif mod == 1:
                split = "val"
            else:
                split = "train"
            record["split"] = split


def make_pending_record(info: PdfInfo, page: int, image_path: Path) -> dict[str, Any]:
    rel_image = image_path.relative_to(PROJECT_ROOT).as_posix()
    return {
        "id": f"{info.document_id}_p{page:04d}",
        "documentId": info.document_id,
        "documentTitle": info.title,
        "sourcePdf": info.path.relative_to(PROJECT_ROOT).as_posix(),
        "pageNumber": page,
        "totalPages": info.page_count,
        "imagePath": rel_image,
        "imageMimeType": "image/png",
        "ocrBlocks": [],
        "context": {
            "bookTitle": info.title,
            "bookDescription": "PDF page sampled for document-to-TTS VLM distillation. Teacher must inspect the rendered page image and produce narration-ready blocks.",
            "glossary": [],
            "skipping": "service-only",
        },
        "teacherOutput": None,
        "annotation": {
            "source": "visual-teacher-required",
            "status": "pending_visual_annotation",
            "schemaVersion": "vlm-block-schema-v1",
            "promptVersion": "document-to-tts-v1",
            "notes": "Do not use the PDF text layer as target. Annotate from rendered PNG according to src/pipeline/prompt.ts.",
        },
    }


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")


def build_stats(infos: list[PdfInfo], records: list[dict[str, Any]]) -> dict[str, Any]:
    split_counts = Counter(record["split"] for record in records)
    source_counts = Counter(record["documentId"] for record in records)
    return {
        "targetPages": len(records),
        "documents": [
            {
                "documentId": info.document_id,
                "title": info.title,
                "sourcePdf": info.path.relative_to(PROJECT_ROOT).as_posix(),
                "pageCount": info.page_count,
                "sampledPages": source_counts[info.document_id],
            }
            for info in infos
        ],
        "splits": dict(sorted(split_counts.items())),
        "annotationSource": "visual-teacher-required",
        "annotationStatus": "pending_visual_annotation",
    }


def write_summary_markdown(stats: dict[str, Any]) -> None:
    lines = [
        "# Visual distillation page queue",
        "",
        f"Rendered page records: **{stats['targetPages']}**.",
        "",
        "> Teacher outputs are intentionally pending. The target must be produced by visual inspection of the rendered PNG page, following `src/pipeline/prompt.ts`. The PDF text layer is not used as teacher truth.",
        "",
        "## Documents",
        "",
        "| Document | Total pages | Sampled pages |",
        "|---|---:|---:|",
    ]
    for doc in stats["documents"]:
        lines.append(
            f"| `{doc['documentId']}` | {doc['pageCount']} | {doc['sampledPages']} |"
        )
    lines.extend(["", "## Splits", "", "| Split | Pages |", "|---|---:|"])
    for split, count in stats["splits"].items():
        lines.append(f"| {split} | {count} |")
    (DATA_DIR / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-pages", type=int, default=300)
    parser.add_argument("--render-dpi", type=int, default=180)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    for tool in ("pdfinfo", "pdftoppm"):
        require_tool(tool)

    RENDERED_DIR.mkdir(parents=True, exist_ok=True)
    DATASET_DIR.mkdir(parents=True, exist_ok=True)

    infos = discover_pdfs()
    allocations = allocate_pages(infos, args.target_pages)
    records: list[dict[str, Any]] = []
    manifest: list[dict[str, Any]] = []

    for info in infos:
        requested = allocations[info.document_id]
        pages = sample_pages(info.page_count, requested)
        manifest.append(
            {
                "documentId": info.document_id,
                "title": info.title,
                "sourcePdf": info.path.relative_to(PROJECT_ROOT).as_posix(),
                "pageCount": info.page_count,
                "sampledPages": pages,
            }
        )
        print(f"[render] {info.document_id}: {len(pages)} / {info.page_count} pages")
        for page in pages:
            image_path = render_page(
                info.path, info.document_id, page, args.render_dpi, args.force
            )
            records.append(make_pending_record(info, page, image_path))

    records.sort(key=lambda r: (r["documentId"], r["pageNumber"]))
    assign_splits(records)

    write_jsonl(DATA_DIR / "visual_queue_300.jsonl", records)
    write_jsonl(DATASET_DIR / "all.jsonl", records)
    for split in ("train", "val", "test"):
        write_jsonl(
            DATASET_DIR / f"{split}.jsonl", [r for r in records if r["split"] == split]
        )

    stats = build_stats(infos, records)
    (DATA_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DATA_DIR / "stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    write_summary_markdown(stats)

    print(f"[render] wrote {len(records)} pending visual records")
    print(
        f"[render] queue: {(DATA_DIR / 'visual_queue_300.jsonl').relative_to(PROJECT_ROOT)}"
    )


if __name__ == "__main__":
    main()
