"""
Document-to-narration benchmark.

Two subcommands:

  convert    Render readme/bench/input.pdf into a sequence of PNG pages
             under readme/bench/pages/.

  run        For each PNG page in readme/bench/pages/, run up to five
             extraction approaches and write one Markdown file per
             approach into readme/bench/out/:

               1. page-XXX.datalab-accurate.md  Datalab Convert, mode=accurate
                                                (built-in LLM polish)
               2. page-XXX.datalab+sonnet.md    Datalab JSON -> Sonnet narration
               3. page-XXX.datalab+opus.md      Datalab JSON -> Opus narration
               4. page-XXX.sonnet.md            Sonnet directly on the PNG
               5. page-XXX.opus.md              Opus directly on the PNG

             The raw Datalab JSON for each page is cached under
             out/cache/ so re-running the LLM-rewrite approaches doesn't
             re-bill the Datalab API.

Usage:
    uv run run_bench.py convert
    uv run run_bench.py convert --dpi 250 --force
    uv run run_bench.py convert --input some/other.pdf

    uv run run_bench.py run
    uv run run_bench.py run --limit 3
    uv run run_bench.py run --pages 1,5,10
    uv run run_bench.py run --only sonnet
    uv run run_bench.py run --only datalab+opus,opus
    uv run run_bench.py run --force

    uv run run_bench.py tts
    uv run run_bench.py tts --only sonnet,opus --limit 3
    uv run run_bench.py tts --force --yes

    uv run run_bench.py tts-merge
    uv run run_bench.py tts-merge --gap 1.5 --only sonnet

Env (readme/bench/.env):
    DATALAB_API_KEY=...
    ANTHROPIC_API_KEY=...
    ELEVENLABS_API_KEY=...
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

# --------------------------------------------------------------------------- #
# Paths & config
# --------------------------------------------------------------------------- #

SCRIPT_DIR = Path(__file__).resolve().parent
PAGES_DIR = SCRIPT_DIR / "pages"
OUT_DIR = SCRIPT_DIR / "out"
CACHE_DIR = OUT_DIR / "cache"
ENV_PATH = SCRIPT_DIR / ".env"
DEFAULT_PDF = SCRIPT_DIR / "input.pdf"

DATALAB_URL = "https://www.datalab.to/api/v1/convert"
DATALAB_POLL_INTERVAL = 2  # seconds
DATALAB_POLL_TIMEOUT = 300  # seconds (5 min per page)

MODEL_SONNET = "claude-sonnet-4-6"
MODEL_OPUS = "claude-opus-4-7"
CLAUDE_MAX_TOKENS = 8192

# ElevenLabs defaults
ELEVEN_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"  # Rachel
ELEVEN_DEFAULT_MODEL = "eleven_v3"
ELEVEN_OUTPUT_FORMAT = "mp3_44100_128"
TTS_APPROACHES = ["datalab+sonnet", "datalab+opus", "sonnet", "opus"]
MERGED_DIR = OUT_DIR / "_merged"

# High-level intent only — let the model rely on its own understanding of
# what "natural narration" means.
NARRATION_PROMPT = (
    "You are preparing the text of this document page so that it can be read "
    "aloud naturally by a text-to-speech engine, the way a human narrator "
    "would read an audiobook.\n\n"
    "Your goal is NOT to mirror the page layout. Your goal is to produce a "
    "clean, linear, listenable narration in the SAME LANGUAGE as the page.\n\n"
    "Reading order and structure:\n"
    "- Output the content in the order a human reader would actually speak it.\n"
    "- Keep section/chapter titles as short standalone lines (you may use a "
    "single '#' or '##' for major headings, nothing fancier).\n"
    "- Merge hyphenated line breaks back into whole words. Join broken "
    "paragraphs into flowing prose.\n"
    "- Use normal paragraph breaks (blank lines). No bullet symbols unless "
    "the list is genuinely meant to be enumerated aloud — in that case, write "
    "'First, ... Second, ... Third, ...' instead of '- ' markers.\n\n"
    "What to SKIP (do not read aloud):\n"
    "- Page numbers, running headers and footers.\n"
    "- Pure navigation artifacts (e.g. 'see page 42', isolated reference "
    "markers like '[12]' with no semantic content).\n"
    "- Decorative repetitions, watermarks, copyright lines on body pages.\n\n"
    "Footnotes, captions, sidebars:\n"
    "- If a footnote is purely a citation/reference, omit it.\n"
    "- If a footnote contains real content, weave it into the narration at a "
    "natural pause after the sentence it belongs to, prefixed with a short "
    "cue like 'Note:' or 'Сноска:' (match the page language).\n"
    "- Read figure/image captions inline at the point the figure is mentioned, "
    "as a normal sentence (e.g. 'On the illustration: ...'). Do not write "
    "'Figure 1:' style labels.\n"
    "- For sidebars / pull quotes with substantive content, read them after "
    "the surrounding paragraph finishes, introduced naturally.\n\n"
    "Tables:\n"
    "- Do NOT output Markdown table syntax (pipes and dashes are unreadable "
    "by TTS).\n"
    "- If the table is small and meaningful, narrate it as prose "
    "(e.g. 'In 2020, revenue was 5 million; in 2021, 7 million; ...').\n"
    "- If the table is large or purely reference data, replace it with a "
    "one-sentence summary of what it contains.\n\n"
    "TTS normalization (write the way it should be SPOKEN):\n"
    "- Expand numbers, dates, currencies, units, and times into words in the "
    "page language (e.g. '1995' -> 'nineteen ninety-five', '$5M' -> 'five "
    "million dollars', '10 km' -> 'ten kilometers').\n"
    "- Expand common abbreviations (e.g. 'Dr.' -> 'Doctor', 'т.е.' -> 'то "
    "есть', 'и т.д.' -> 'и так далее').\n"
    "- Spell out symbols when they carry meaning (%, &, §, ©, etc.).\n"
    "- Convert simple inline formulas to spoken form "
    "('E = mc^2' -> 'E equals m c squared').\n"
    "- Remove URLs and long file paths, or replace with a short spoken cue.\n\n"
    "Non-text visual content (illustrations, photos, diagrams, schemes, maps, "
    "charts, complex formulas, etc.):\n"
    "- Do not try to read the visual aloud. Instead, give a brief factual "
    "description of what you see, in the language of the page, wrapped in "
    "<visual>...</visual> tags, placed at the position where the visual "
    "appears in the reading flow.\n"
    "- Do not invent details you cannot actually see.\n\n"
    "Faithfulness:\n"
    "- Do not invent, summarize, or paraphrase the main body content. Keep "
    "every meaningful sentence, just cleaned up for the ear.\n"
    "- Do not translate. Keep the original language of the page.\n\n"
    "Output format:\n"
    "- Output ONLY the narration text. No commentary, no explanations, no "
    "wrappers like ```markdown.\n"
    "- If the page is empty or has no readable content (e.g. a blank page or "
    "a pure cover image with no text), output an empty string.\n"
)

JSON_NARRATION_PROMPT = (
    "Below is the structured content of a single document page, extracted "
    "as JSON blocks (with types, reading order, and text) by a document "
    "parser. Your job is to turn these blocks into text that can be read "
    "aloud naturally by a text-to-speech engine, the way a human narrator "
    "would read an audiobook.\n\n"
    "Your goal is NOT to mirror the JSON structure. Your goal is to produce "
    "a clean, linear, listenable narration in the SAME LANGUAGE as the "
    "content.\n\n"
    "Reading order and structure:\n"
    "- Output the content in the order a human reader would actually speak it, "
    "using the JSON reading order as your starting point.\n"
    "- Keep section/chapter titles as short standalone lines (you may use a "
    "single '#' or '##' for major headings, nothing fancier).\n"
    "- Merge hyphenated line breaks back into whole words. Join broken "
    "paragraphs into flowing prose.\n"
    "- Use normal paragraph breaks (blank lines). No bullet symbols unless "
    "the list is genuinely meant to be enumerated aloud — in that case, write "
    "'First, ... Second, ... Third, ...' instead of '- ' markers.\n\n"
    "What to SKIP (do not read aloud):\n"
    "- Page numbers, running headers and footers.\n"
    "- Pure navigation artifacts (e.g. 'see page 42', isolated reference "
    "markers like '[12]' with no semantic content).\n"
    "- Decorative repetitions, watermarks, copyright lines on body pages.\n\n"
    "Footnotes, captions, sidebars:\n"
    "- If a footnote is purely a citation/reference, omit it.\n"
    "- If a footnote contains real content, weave it into the narration at a "
    "natural pause after the sentence it belongs to, prefixed with a short "
    "cue like 'Note:' or 'Сноска:' (match the content language).\n"
    "- Read figure/image captions inline at the point the figure is mentioned, "
    "as a normal sentence (e.g. 'On the illustration: ...'). Do not write "
    "'Figure 1:' style labels.\n"
    "- For sidebars / pull quotes with substantive content, read them after "
    "the surrounding paragraph finishes, introduced naturally.\n\n"
    "Tables:\n"
    "- Do NOT output Markdown table syntax (pipes and dashes are unreadable "
    "by TTS).\n"
    "- If the table is small and meaningful, narrate it as prose "
    "(e.g. 'In 2020, revenue was 5 million; in 2021, 7 million; ...').\n"
    "- If the table is large or purely reference data, replace it with a "
    "one-sentence summary of what it contains.\n\n"
    "TTS normalization (write the way it should be SPOKEN):\n"
    "- Expand numbers, dates, currencies, units, and times into words in the "
    "content language (e.g. '1995' -> 'nineteen ninety-five', '$5M' -> 'five "
    "million dollars', '10 km' -> 'ten kilometers').\n"
    "- Expand common abbreviations (e.g. 'Dr.' -> 'Doctor', 'т.е.' -> 'то "
    "есть', 'и т.д.' -> 'и так далее').\n"
    "- Spell out symbols when they carry meaning (%, &, §, ©, etc.).\n"
    "- Convert simple inline formulas to spoken form "
    "('E = mc^2' -> 'E equals m c squared').\n"
    "- Remove URLs and long file paths, or replace with a short spoken cue.\n\n"
    "Non-text visual blocks (e.g. blocks of type Figure, Picture, Image, "
    "Diagram with no readable text):\n"
    "- Do not try to read them aloud. Instead, give a brief factual "
    "description based ONLY on what the JSON tells you (caption, surrounding "
    "context, block type), in the language of the content, wrapped in "
    "<visual>...</visual> tags at the corresponding position in the reading "
    "flow.\n"
    "- Do not invent details that are not supported by the JSON.\n\n"
    "Faithfulness:\n"
    "- Do not invent, summarize, or paraphrase the main body content. Keep "
    "every meaningful sentence, just cleaned up for the ear.\n"
    "- Do not translate. Keep the original language of the content.\n\n"
    "Output format:\n"
    "- Output ONLY the narration text. No commentary, no explanations, no "
    "wrappers like ```markdown.\n"
    "- If there is no readable content, output an empty string.\n\n"
    "Page JSON:\n"
)

# --------------------------------------------------------------------------- #
# PDF -> PNG conversion (pypdfium2)
# --------------------------------------------------------------------------- #


def convert_pdf_to_pngs(pdf_path: Path, out_dir: Path, dpi: int, force: bool) -> None:
    import pypdfium2 as pdfium

    if not pdf_path.exists():
        sys.exit(f"PDF not found: {pdf_path}")

    out_dir.mkdir(parents=True, exist_ok=True)

    pdf = pdfium.PdfDocument(str(pdf_path))
    n = len(pdf)
    width = max(3, len(str(n)))
    scale = dpi / 72  # PDF points -> pixels at given DPI

    print(f"Converting {pdf_path.name} ({n} pages) at {dpi} DPI -> {out_dir}")

    for i in range(n):
        out_path = out_dir / f"page-{str(i + 1).zfill(width)}.png"
        if out_path.exists() and not force:
            print(f"  [{i + 1}/{n}] skip (exists: {out_path.name})")
            continue

        page = pdf[i]
        bitmap = page.render(scale=scale)  # type: ignore[arg-type]
        pil = bitmap.to_pil()
        pil.save(out_path, format="PNG")
        page.close()
        print(f"  [{i + 1}/{n}] wrote {out_path.name}  ({pil.size[0]}x{pil.size[1]})")

    pdf.close()
    print("\nDone.")


# --------------------------------------------------------------------------- #
# Datalab Convert
# --------------------------------------------------------------------------- #


def _datalab_submit(
    png_path: Path, api_key: str, *, mode: str, output_format: str
) -> str:
    """Submit a job to Datalab Convert and return the request_check_url.

    `mode` is the new replacement for the deprecated `use_llm` flag:
        - "fast"     : lowest latency, OCR-only quality
        - "balanced" : OCR + light LLM polish
        - "accurate" : full LLM polish (equivalent to old use_llm=true)
    """
    with png_path.open("rb") as f:
        files = {
            "file": (png_path.name, f, "image/png"),
            "mode": (None, mode),
            "paginate": (None, "false"),
            "output_format": (None, output_format),
            "disable_image_extraction": (None, "true"),
        }
        headers = {"X-Api-Key": api_key}
        resp = requests.post(DATALAB_URL, files=files, headers=headers, timeout=60)

    if resp.status_code != 200:
        raise RuntimeError(
            f"Datalab submit failed ({resp.status_code}): {resp.text[:500]}"
        )
    data = resp.json()
    if not data.get("success"):
        raise RuntimeError(f"Datalab submit error: {data}")
    return data["request_check_url"]


def _datalab_poll(check_url: str, api_key: str) -> dict:
    """Poll a Datalab job until completion and return the final payload."""
    headers = {"X-Api-Key": api_key}
    deadline = time.time() + DATALAB_POLL_TIMEOUT
    while time.time() < deadline:
        time.sleep(DATALAB_POLL_INTERVAL)
        r = requests.get(check_url, headers=headers, timeout=30)
        if r.status_code != 200:
            raise RuntimeError(f"Datalab poll failed ({r.status_code}): {r.text[:500]}")
        payload = r.json()
        if payload.get("status") == "complete":
            if not payload.get("success"):
                raise RuntimeError(f"Datalab job failed: {payload.get('error')}")
            return payload
    raise TimeoutError(f"Datalab job timed out after {DATALAB_POLL_TIMEOUT}s")


def datalab_markdown_accurate(png_path: Path, api_key: str) -> str:
    """Datalab Convert in 'accurate' mode → Markdown (LLM-polished)."""
    check_url = _datalab_submit(
        png_path, api_key, mode="accurate", output_format="markdown"
    )
    payload = _datalab_poll(check_url, api_key)
    return payload.get("markdown", "") or ""


def datalab_json(png_path: Path, api_key: str) -> dict:
    """Datalab Convert in 'fast' mode → structured JSON blocks (no LLM polish)."""
    check_url = _datalab_submit(png_path, api_key, mode="fast", output_format="json")
    payload = _datalab_poll(check_url, api_key)
    # The structured blocks live under the "json" key in the response.
    return payload.get("json") or payload


def get_datalab_json_cached(png_path: Path, api_key: str) -> dict:
    """Cache the raw Datalab JSON per page on disk."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = CACHE_DIR / f"{png_path.stem}.datalab.json"
    if cache_path.exists():
        return json.loads(cache_path.read_text(encoding="utf-8"))
    data = datalab_json(png_path, api_key)
    cache_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return data


# --------------------------------------------------------------------------- #
# Claude
# --------------------------------------------------------------------------- #


def _strip_code_fences(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^```(?:[a-zA-Z]+)?\s*\n", "", text)
    text = re.sub(r"\n```\s*$", "", text)
    return text


def _claude_client(api_key: str):
    from anthropic import Anthropic

    return Anthropic(api_key=api_key)


def claude_from_image(png_path: Path, api_key: str, model: str) -> str:
    """Run Claude directly on the page image to produce TTS narration."""
    client = _claude_client(api_key)
    img_b64 = base64.standard_b64encode(png_path.read_bytes()).decode("ascii")

    msg = client.messages.create(
        model=model,
        max_tokens=CLAUDE_MAX_TOKENS,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": img_b64,
                        },
                    },
                    {"type": "text", "text": NARRATION_PROMPT},
                ],
            }
        ],
    )
    parts = [
        b.text  # type: ignore[union-attr]
        for b in msg.content
        if getattr(b, "type", None) == "text" and hasattr(b, "text")
    ]
    return _strip_code_fences("\n".join(parts))


def claude_from_datalab_json(blocks: dict, api_key: str, model: str) -> str:
    """Run Claude on Datalab's structured JSON to produce TTS narration."""
    client = _claude_client(api_key)
    blocks_text = json.dumps(blocks, ensure_ascii=False, indent=2)

    msg = client.messages.create(
        model=model,
        max_tokens=CLAUDE_MAX_TOKENS,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": JSON_NARRATION_PROMPT + blocks_text},
                ],
            }
        ],
    )
    parts = [
        b.text  # type: ignore[union-attr]
        for b in msg.content
        if getattr(b, "type", None) == "text" and hasattr(b, "text")
    ]
    return _strip_code_fences("\n".join(parts))


# --------------------------------------------------------------------------- #
# Approach registry
# --------------------------------------------------------------------------- #

APPROACHES = [
    "datalab-accurate",
    "datalab+sonnet",
    "datalab+opus",
    "sonnet",
    "opus",
]


def build_runners(datalab_key: str | None, anthropic_key: str | None):
    """Return a dict: approach_name -> (out_suffix, missing_env_keys, runner)."""

    def missing(*keys: str) -> list[str]:
        out = []
        for k in keys:
            v = datalab_key if k == "DATALAB_API_KEY" else anthropic_key
            if not v:
                out.append(k)
        return out

    def run_datalab_accurate(png: Path) -> str:
        return datalab_markdown_accurate(png, datalab_key)  # type: ignore[arg-type]

    def run_datalab_sonnet(png: Path) -> str:
        blocks = get_datalab_json_cached(png, datalab_key)  # type: ignore[arg-type]
        return claude_from_datalab_json(blocks, anthropic_key, MODEL_SONNET)  # type: ignore[arg-type]

    def run_datalab_opus(png: Path) -> str:
        blocks = get_datalab_json_cached(png, datalab_key)  # type: ignore[arg-type]
        return claude_from_datalab_json(blocks, anthropic_key, MODEL_OPUS)  # type: ignore[arg-type]

    def run_sonnet(png: Path) -> str:
        return claude_from_image(png, anthropic_key, MODEL_SONNET)  # type: ignore[arg-type]

    def run_opus(png: Path) -> str:
        return claude_from_image(png, anthropic_key, MODEL_OPUS)  # type: ignore[arg-type]

    return {
        "datalab-accurate": (
            "datalab-accurate.md",
            missing("DATALAB_API_KEY"),
            run_datalab_accurate,
        ),
        "datalab+sonnet": (
            "datalab+sonnet.md",
            missing("DATALAB_API_KEY", "ANTHROPIC_API_KEY"),
            run_datalab_sonnet,
        ),
        "datalab+opus": (
            "datalab+opus.md",
            missing("DATALAB_API_KEY", "ANTHROPIC_API_KEY"),
            run_datalab_opus,
        ),
        "sonnet": ("sonnet.md", missing("ANTHROPIC_API_KEY"), run_sonnet),
        "opus": ("opus.md", missing("ANTHROPIC_API_KEY"), run_opus),
    }


# --------------------------------------------------------------------------- #
# Run driver
# --------------------------------------------------------------------------- #


def _page_num(path: Path) -> int:
    m = re.search(r"page-(\d+)", path.stem)
    return int(m.group(1)) if m else -1


def discover_pages(pages_arg: str | None, limit: int | None) -> list[Path]:
    all_pngs = sorted(PAGES_DIR.glob("page-*.png"))
    if not all_pngs:
        sys.exit(
            f"No PNG pages found in {PAGES_DIR}.\n"
            f"Run `uv run run_bench.py convert` first."
        )

    if pages_arg:
        wanted = {int(x) for x in pages_arg.split(",") if x.strip()}
        selected = [p for p in all_pngs if _page_num(p) in wanted]
    else:
        selected = all_pngs

    if limit is not None:
        selected = selected[:limit]
    return selected


def parse_only(only_arg: str | None) -> list[str]:
    if not only_arg:
        return list(APPROACHES)
    requested = [x.strip() for x in only_arg.split(",") if x.strip()]
    unknown = [x for x in requested if x not in APPROACHES]
    if unknown:
        sys.exit(f"Unknown approach(es): {unknown}. Available: {', '.join(APPROACHES)}")
    return requested


def process_page(
    png: Path,
    approaches: list[str],
    runners: dict,
    force: bool,
) -> None:
    for name in approaches:
        suffix, missing, runner = runners[name]
        out_path = OUT_DIR / f"{png.stem}.{suffix}"

        if missing:
            print(f"  [{name}] skip (missing env: {', '.join(missing)})")
            continue
        if out_path.exists() and not force:
            print(f"  [{name}] skip (exists: {out_path.name})")
            continue

        t0 = time.time()
        try:
            md = runner(png)
        except Exception as e:  # noqa: BLE001
            print(f"  [{name}] ERROR: {e}")
            continue
        dt = time.time() - t0
        out_path.write_text(md, encoding="utf-8")
        print(f"  [{name}] ok  -> {out_path.name}  ({len(md)} chars, {dt:.1f}s)")


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def cmd_convert(args: argparse.Namespace) -> None:
    pdf_path = Path(args.input).resolve() if args.input else DEFAULT_PDF
    convert_pdf_to_pngs(pdf_path, PAGES_DIR, dpi=args.dpi, force=args.force)


def cmd_run(args: argparse.Namespace) -> None:
    load_dotenv(ENV_PATH)
    load_dotenv()  # also pick up project-root .env if present

    datalab_key = os.getenv("DATALAB_API_KEY")
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    pages = discover_pages(args.pages, args.limit)
    approaches = parse_only(args.only)
    runners = build_runners(datalab_key, anthropic_key)

    print(
        f"Processing {len(pages)} page(s) x {len(approaches)} approach(es) -> {OUT_DIR}"
    )
    print(f"Approaches: {', '.join(approaches)}")
    if not datalab_key:
        print("WARNING: DATALAB_API_KEY not set")
    if not anthropic_key:
        print("WARNING: ANTHROPIC_API_KEY not set")

    for i, png in enumerate(pages, 1):
        print(f"\n[{i}/{len(pages)}] {png.name}")
        process_page(png, approaches, runners, args.force)

    print("\nDone.")


# --------------------------------------------------------------------------- #
# TTS (ElevenLabs)
# --------------------------------------------------------------------------- #


_VISUAL_TAG_RE = re.compile(r"<visual>.*?</visual>", re.IGNORECASE | re.DOTALL)
_MD_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+", re.MULTILINE)
_MD_BULLET_RE = re.compile(r"^\s*[-*+]\s+", re.MULTILINE)
_MD_BOLD_RE = re.compile(r"\*\*(.+?)\*\*|__(.+?)__", re.DOTALL)
_MD_ITALIC_RE = re.compile(
    r"(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)|(?<!_)_(?!\s)(.+?)(?<!\s)_(?!_)", re.DOTALL
)
_MD_CODE_FENCE_RE = re.compile(r"```.*?```", re.DOTALL)
_MD_INLINE_CODE_RE = re.compile(r"`([^`]+)`")
_MULTI_BLANK_RE = re.compile(r"\n{3,}")


def md_to_tts_text(md: str) -> str:
    """Strip markdown + remove <visual>...</visual> blocks for TTS input."""
    text = md
    text = _VISUAL_TAG_RE.sub("", text)
    text = _MD_CODE_FENCE_RE.sub("", text)
    text = _MD_HEADING_RE.sub("", text)
    text = _MD_BULLET_RE.sub("", text)
    text = _MD_BOLD_RE.sub(lambda m: m.group(1) or m.group(2) or "", text)
    text = _MD_ITALIC_RE.sub(lambda m: m.group(1) or m.group(2) or "", text)
    text = _MD_INLINE_CODE_RE.sub(r"\1", text)
    text = _MULTI_BLANK_RE.sub("\n\n", text)
    return text.strip()


def discover_tts_jobs(approaches: list[str], pages_arg: str | None, limit: int | None):
    """Yield (approach, page_num, md_path, mp3_path, text) for each .md output."""
    jobs = []
    wanted_pages: set[int] | None = None
    if pages_arg:
        wanted_pages = {int(x) for x in pages_arg.split(",") if x.strip()}

    for approach in approaches:
        suffix = f".{approach}.md"
        md_files = sorted(OUT_DIR.glob(f"page-*{suffix}"))
        for md_path in md_files:
            page = _page_num(md_path)
            if wanted_pages is not None and page not in wanted_pages:
                continue
            stem = md_path.name[: -len(".md")]
            mp3_path = OUT_DIR / f"{stem}.mp3"
            md_text = md_path.read_text(encoding="utf-8")
            tts_text = md_to_tts_text(md_text)
            jobs.append((approach, page, md_path, mp3_path, tts_text))

    if limit is not None:
        # Limit per approach, not total.
        per_approach: dict[str, int] = {}
        filtered = []
        for j in jobs:
            approach = j[0]
            if per_approach.get(approach, 0) >= limit:
                continue
            per_approach[approach] = per_approach.get(approach, 0) + 1
            filtered.append(j)
        jobs = filtered

    return jobs


def _eleven_client(api_key: str):
    from elevenlabs.client import ElevenLabs

    return ElevenLabs(api_key=api_key)


def synth_to_mp3(
    client, text: str, voice_id: str, model_id: str, out_path: Path
) -> None:
    audio_iter = client.text_to_speech.convert(
        text=text,
        voice_id=voice_id,
        model_id=model_id,
        output_format=ELEVEN_OUTPUT_FORMAT,
    )
    # Buffer in memory first so we never leave a 0-byte file on disk if the
    # stream errors out mid-flight or returns nothing.
    buf = bytearray()
    for chunk in audio_iter:
        if chunk:
            buf.extend(chunk)
    if not buf:
        raise RuntimeError("ElevenLabs returned no audio bytes")
    out_path.write_bytes(bytes(buf))


def cmd_tts(args: argparse.Namespace) -> None:
    load_dotenv(ENV_PATH)
    load_dotenv()

    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        sys.exit("ELEVENLABS_API_KEY not set in bench/.env")

    approaches = parse_tts_only(args.only)
    jobs = discover_tts_jobs(approaches, args.pages, args.limit)

    if not jobs:
        sys.exit("No matching .md files found in out/. Run `run` first.")

    # Filter out empty texts and existing files (unless --force).
    pending = []
    skipped_exists = 0
    skipped_empty = 0
    for j in jobs:
        approach, page, md_path, mp3_path, text = j
        if not text:
            skipped_empty += 1
            continue
        if mp3_path.exists() and not args.force:
            skipped_exists += 1
            continue
        pending.append(j)

    total_chars = sum(len(j[4]) for j in pending)
    print(f"Voice: {args.voice}   Model: {args.model}")
    print(
        f"Pending TTS jobs: {len(pending)}  (exists skipped: {skipped_exists}, empty: {skipped_empty})"
    )
    print(f"Total characters to synthesize: {total_chars:,}")
    print(
        f"Approx ElevenLabs credits: ~{total_chars:,} (1 char = 1 credit on multilingual/v3)"
    )

    if not pending:
        print("Nothing to do.")
        return

    if not args.yes:
        ans = input("Proceed? [y/N]: ").strip().lower()
        if ans not in ("y", "yes"):
            print("Aborted.")
            return

    client = _eleven_client(api_key)

    for i, (approach, page, md_path, mp3_path, text) in enumerate(pending, 1):
        t0 = time.time()
        try:
            synth_to_mp3(client, text, args.voice, args.model, mp3_path)
        except Exception as e:  # noqa: BLE001
            print(f"  [{i}/{len(pending)}] {mp3_path.name}  ERROR: {e}")
            continue
        dt = time.time() - t0
        size_kb = mp3_path.stat().st_size / 1024
        print(
            f"  [{i}/{len(pending)}] {mp3_path.name}  ({len(text)} chars, {size_kb:.0f} KB, {dt:.1f}s)"
        )

    print("\nDone.")


def parse_tts_only(only_arg: str | None) -> list[str]:
    if not only_arg:
        return list(TTS_APPROACHES)
    requested = [x.strip() for x in only_arg.split(",") if x.strip()]
    unknown = [x for x in requested if x not in TTS_APPROACHES]
    if unknown:
        sys.exit(
            f"Unknown TTS approach(es): {unknown}. "
            f"Available: {', '.join(TTS_APPROACHES)}"
        )
    return requested


def _ffmpeg_concat_with_gaps(
    mp3s: list[Path], gap_seconds: float, out_path: Path
) -> None:
    """Concat mp3s with a silence gap between them using ffmpeg's concat filter.

    Re-encodes the output (filter graph requires it). All inputs are decoded
    and concatenated; silence is generated inline via the anullsrc filter.
    """
    import subprocess

    if not mp3s:
        raise ValueError("no inputs")

    # Build inputs: each file as -i
    cmd: list[str] = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    for mp3 in mp3s:
        cmd += ["-i", str(mp3)]

    n = len(mp3s)
    # Filter graph:
    #   - generate one silent stream of `gap_seconds`
    #   - alternate [0:a][silence][1:a][silence][2:a]...
    if n == 1 or gap_seconds <= 0:
        # Simple concat, no silence needed
        inputs = "".join(f"[{i}:a]" for i in range(n))
        filter_complex = f"{inputs}concat=n={n}:v=0:a=1[out]"
    else:
        filter_parts = [
            f"anullsrc=r=44100:cl=stereo:d={gap_seconds}[sil]",
        ]
        # Build the alternating stream list. We reuse [sil] (n-1) times by
        # splitting it.
        gaps = n - 1
        split_outs = "".join(f"[s{i}]" for i in range(gaps))
        filter_parts.append(f"[sil]asplit={gaps}{split_outs}")

        seq: list[str] = []
        for i in range(n):
            seq.append(f"[{i}:a]")
            if i < n - 1:
                seq.append(f"[s{i}]")
        total = n + gaps
        filter_parts.append("".join(seq) + f"concat=n={total}:v=0:a=1[out]")
        filter_complex = ";".join(filter_parts)

    cmd += [
        "-filter_complex",
        filter_complex,
        "-map",
        "[out]",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        str(out_path),
    ]

    subprocess.run(cmd, check=True)


def cmd_tts_merge(args: argparse.Namespace) -> None:
    approaches = parse_tts_only(args.only)
    MERGED_DIR.mkdir(parents=True, exist_ok=True)

    for approach in approaches:
        suffix = f".{approach}.mp3"
        all_mp3s = sorted(
            (p for p in OUT_DIR.glob(f"page-*{suffix}")),
            key=_page_num,
        )
        if not all_mp3s:
            print(f"[{approach}] no .mp3 files, skip")
            continue

        # Skip empty / unreadably-small files (failed TTS leaves 0-byte mp3s).
        mp3s: list[Path] = []
        bad: list[Path] = []
        for p in all_mp3s:
            if p.stat().st_size < 256:
                bad.append(p)
            else:
                mp3s.append(p)
        if bad:
            print(
                f"[{approach}] WARNING: skipping {len(bad)} empty/bad file(s): "
                + ", ".join(b.name for b in bad)
            )
        if not mp3s:
            print(f"[{approach}] nothing valid to merge, skip")
            continue

        out_path = MERGED_DIR / f"{approach}.mp3"
        if out_path.exists() and not args.force:
            print(f"[{approach}] skip (exists: {out_path.relative_to(OUT_DIR)})")
            continue

        print(
            f"[{approach}] merging {len(mp3s)} files (gap {args.gap}s) -> {out_path.relative_to(OUT_DIR)}"
        )
        try:
            _ffmpeg_concat_with_gaps(mp3s, args.gap, out_path)
        except Exception as e:  # noqa: BLE001
            print(f"  ERROR: {e}")
            continue
        size_kb = out_path.stat().st_size / 1024
        print(f"  -> {out_path.name}  ({size_kb:.0f} KB)")

    print("\nDone.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="run_bench",
        description="Document-to-narration benchmark (convert + run).",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_convert = sub.add_parser(
        "convert",
        help="Render input PDF into PNG pages under bench/pages/.",
    )
    p_convert.add_argument(
        "--input",
        type=str,
        default=None,
        help=f"Path to PDF (default: {DEFAULT_PDF.name} in bench/).",
    )
    p_convert.add_argument(
        "--dpi", type=int, default=200, help="Render DPI (default: 200)."
    )
    p_convert.add_argument(
        "--force", action="store_true", help="Overwrite existing PNG pages."
    )
    p_convert.set_defaults(func=cmd_convert)

    p_run = sub.add_parser(
        "run",
        help="Run extraction approaches over the rendered pages.",
    )
    p_run.add_argument(
        "--limit", type=int, default=None, help="Process only first N pages."
    )
    p_run.add_argument(
        "--pages",
        type=str,
        default=None,
        help="Comma-separated page numbers, e.g. 1,5,10.",
    )
    p_run.add_argument(
        "--only",
        type=str,
        default=None,
        help=(
            "Comma-separated list of approaches to run. "
            f"Available: {', '.join(APPROACHES)}."
        ),
    )
    p_run.add_argument(
        "--force", action="store_true", help="Overwrite existing outputs."
    )
    p_run.set_defaults(func=cmd_run)

    p_tts = sub.add_parser(
        "tts",
        help="Generate ElevenLabs mp3 next to each .md output (4 approaches).",
    )
    p_tts.add_argument(
        "--only",
        type=str,
        default=None,
        help=(
            "Comma-separated approaches to TTS. "
            f"Available: {', '.join(TTS_APPROACHES)}."
        ),
    )
    p_tts.add_argument(
        "--pages",
        type=str,
        default=None,
        help="Comma-separated page numbers, e.g. 1,5,10.",
    )
    p_tts.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process only first N pages per approach.",
    )
    p_tts.add_argument(
        "--voice",
        type=str,
        default=ELEVEN_DEFAULT_VOICE,
        help=f"ElevenLabs voice_id (default: {ELEVEN_DEFAULT_VOICE} = Rachel).",
    )
    p_tts.add_argument(
        "--model",
        type=str,
        default=ELEVEN_DEFAULT_MODEL,
        help=f"ElevenLabs model_id (default: {ELEVEN_DEFAULT_MODEL}).",
    )
    p_tts.add_argument(
        "--force",
        action="store_true",
        help="Re-synthesize even if .mp3 exists.",
    )
    p_tts.add_argument(
        "--yes",
        action="store_true",
        help="Skip the cost-confirmation prompt.",
    )
    p_tts.set_defaults(func=cmd_tts)

    p_merge = sub.add_parser(
        "tts-merge",
        help="Concatenate per-page mp3s into one file per approach with gaps.",
    )
    p_merge.add_argument(
        "--only",
        type=str,
        default=None,
        help=(
            "Comma-separated approaches to merge. "
            f"Available: {', '.join(TTS_APPROACHES)}."
        ),
    )
    p_merge.add_argument(
        "--gap",
        type=float,
        default=1.5,
        help="Silence between pages, in seconds (default: 1.5).",
    )
    p_merge.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing merged mp3.",
    )
    p_merge.set_defaults(func=cmd_tts_merge)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
