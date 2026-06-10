# Visual teacher annotation guide

This dataset is for distilling the `VlmClient.analyzePage()` behavior used by the app.

## Inputs per page

For each record use both files:

1. Rendered page image: `imagePath` from the queue record.
2. DataLab layout JSON: `ocrLayoutPath` from the queue record.

The image is the source of truth. DataLab text, labels, bounding boxes, and ids are layout/OCR hints only.
Do not use the PDF text layer as target.

## Output

Each output line is the full queue record with `teacherOutput` filled:

```json
{
  "blocks": [
    {
      "type": "paragraph",
      "text": "TTS-normalized narration text.",
      "rawText": "Verbatim page text when useful.",
      "isFigure": false,
      "isMainContent": true,
      "ocrBlockIds": ["ocr_..."]
    }
  ],
  "pageLanguage": "English"
}
```

The schema must match `src/types/vlm.ts` and `src/pipeline/prompt.ts`.

## Block types

Allowed types:

- `heading`
- `paragraph`
- `list`
- `quote`
- `caption`
- `figure`
- `page-number`
- `footnote`
- `header-footer`
- `toc`
- `service`
- `unknown`

## Main rules

- Emit blocks in natural narration order.
- Use `ocrBlockIds` from DataLab for the visual regions represented by the narration block.
- Merge hard line breaks and repair hyphenated line breaks.
- Normalize text for TTS:
  - `Ph.D.` → `P H D` or natural spoken equivalent.
  - `I/O` → `input/output`.
  - `CPU`, `RAM`, `ROM`, `PDF`, `HTML` → letter-style when not naturally pronounced.
  - Units like `100 MHz` → `100 megahertz`.
- Keep `rawText` as the visible page text before normalization when the block is text-based.
- For `figure`, write a concise spoken description from the image, not just DataLab's text if it is wrong or generic.
- For captions, emit a separate `caption` block if a printed caption exists.
- Service elements such as publisher locations, copyright notices, ISBNs, running headers, and page numbers should be typed as `service`, `header-footer`, or `page-number` and `isMainContent: false`.
- Main content block types (`heading`, `paragraph`, `list`, `quote`, `caption`, `figure`) normally have `isMainContent: true`.

## Annotation status

For visually reviewed records set:

```json
"annotation": {
  "source": "gpt-visual-teacher",
  "status": "gold_visual_reviewed",
  "visualReviewed": true,
  "schemaVersion": "vlm-block-schema-v1",
  "promptVersion": "document-to-tts-v1"
}
```

## File naming

Partial gold annotations should be written as JSONL files under:

`ml/data/annotations/gold_part_XXX_YYY.jsonl`

where `XXX_YYY` is the 1-based inclusive range in `visual_queue_with_datalab.jsonl`.
