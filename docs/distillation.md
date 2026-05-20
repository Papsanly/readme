# Distillation pipeline

This document describes the current teacher-student distillation artifacts for the document-to-TTS
VLM stage.

## Goal

The distilled model must reproduce the app-level VLM contract:

- input: rendered page image, DataLab layout/OCR hints, book context, skipping mode, glossary;
- output: `VlmPageResult` with `blocks` and `pageLanguage`;
- block schema: `src/types/vlm.ts`;
- behavior rules: `src/pipeline/prompt.ts`.

The output is not raw OCR. It is narration-ready, TTS-normalized, block-classified text with OCR
block id alignment.

## Current dataset snapshot

Final dataset path:

- `ml/data/annotations/teacher_final_300.jsonl`

SFT dataset paths:

- `ml/data/dataset/sft_final.jsonl`
- `ml/data/dataset/sft_train_final.jsonl`
- `ml/data/dataset/sft_val_final.jsonl`
- `ml/data/dataset/sft_test_final.jsonl`

Current stats from `ml/data/final_stats.json`:

| Metric                 | Value |
| ---------------------- | ----: |
| Rendered PNG pages     |   300 |
| DataLab layout pages   |   300 |
| Final records          |   300 |
| Visual gold pages      |   149 |
| Silver pages           |   151 |
| Total narration blocks |  3566 |
| Validation errors      |     0 |
| Train records          |   236 |
| Validation records     |    32 |
| Test records           |    32 |

Document distribution:

| Document                                                              | Pages |
| --------------------------------------------------------------------- | ----: |
| `digital-computer-electronics-albert-paul-malvino-and-jerald-a-brown` |   149 |
| `the-definitive-guide-to-the-arm-cortex-m3-2nd`                       |   126 |
| `shenzhen-io-manual-chinese`                                          |    13 |
| `no-1`                                                                |     6 |
| `no-2`                                                                |     6 |

Language distribution:

| Language | Pages |
| -------- | ----: |
| English  |   280 |
| Russian  |    20 |

Block distribution:

| Block type      | Count |
| --------------- | ----: |
| `paragraph`     |  1806 |
| `heading`       |   758 |
| `figure`        |   381 |
| `caption`       |   270 |
| `list`          |   140 |
| `header-footer` |   125 |
| `toc`           |    36 |
| `service`       |    27 |
| `footnote`      |    11 |
| `page-number`   |     9 |
| `quote`         |     2 |
| `unknown`       |     1 |

## Pipeline commands

Render/sampling queue:

`python ml/scripts/prepare_distillation_dataset.py --target-pages 300`

Run DataLab layout for all rendered pages:

`python ml/scripts/run_datalab_layout.py --poll-interval-sec 1`

Generate complete silver targets from DataLab layout:

`python ml/scripts/generate_silver_teacher_dataset.py`

Merge visual-gold overrides with silver records:

`python ml/scripts/build_final_dataset.py`

Validate final records:

`python ml/scripts/validate_vlm_dataset.py ml/data/annotations/teacher_final_300.jsonl`

Summarize final stats:

`python ml/scripts/summarize_dataset.py`

## Annotation levels

### Gold visual teacher records

Gold records are reviewed from:

1. rendered PNG page;
2. DataLab layout JSON.

They use DataLab ids for alignment but the normalized target is visually checked. Current gold
files:

- `gold_part_001_003.jsonl`
- `gold_part_004_020.jsonl`
- `gold_part_021_040.jsonl`
- `gold_part_041_060.jsonl`
- `gold_part_061_070.jsonl`
- `gold_part_071_080.jsonl`
- `gold_part_081_100.jsonl`
- `gold_part_101_110.jsonl`
- `gold_part_111_120.jsonl`
- `gold_part_121_130.jsonl`
- `gold_part_131_140.jsonl`
- `gold_part_141_149.jsonl`

### Silver records

Silver records are complete schema-valid training targets generated from DataLab layout and
deterministic TTS normalization. They are useful for bootstrap fine-tuning and validation of the
pipeline, but final thesis-quality metrics should distinguish them from gold records.

## Recommended training setup

Primary student candidate:

- `Qwen2.5-VL-3B-Instruct` with LoRA or QLoRA.

Alternative candidates:

- `Qwen2.5-VL-7B-Instruct` if 3B quality is insufficient;
- `InternVL2.5-2B/4B`;
- `SmolVLM` for a smaller prototype.

Training strategy:

1. Train on `sft_train_final.jsonl`.
2. Validate on `sft_val_final.jsonl`.
3. Report final metrics on `sft_test_final.jsonl`.
4. Report gold-only metrics separately where possible.
5. Keep teacher fallback in the product architecture for invalid JSON or low-confidence outputs.

## Evaluation metrics

Use task-specific metrics, not only ROUGE/BLEU:

- schema validity rate;
- block type accuracy/F1;
- `isMainContent` accuracy/F1;
- service-element skip precision/recall;
- OCR id alignment precision/recall;
- TTS-normalization targeted tests for abbreviations, units, technical notation;
- latency per page;
- cost per 1000 pages;
- qualitative listening examples.

## Current limitation

The current dataset is sufficient for a thesis prototype and first LoRA run, but it is not a
production-scale corpus. The honest formulation is:

> A compact 300-page document-to-TTS distillation corpus was built from rendered PDF pages and
> DataLab layout hints. 149 pages were visually reviewed as gold teacher records; the remaining
> pages were kept as schema-valid silver records for bootstrap fine-tuning.
