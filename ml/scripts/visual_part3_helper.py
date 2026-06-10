import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "ml" / "data" / "annotations" / "teacher_silver_300.jsonl"
OUT_DIR = ROOT / "ml" / "data" / "annotations"
START = 121
END = 180


def load_records():
    records = []
    with SRC.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            if START <= line_no <= END:
                rec = json.loads(line)
                records.append((line_no, rec))
    return records


def get_font(size=24):
    for name in ["arial.ttf", "DejaVuSans.ttf"]:
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            pass
    return ImageFont.load_default()


def draw_wrapped(draw, xy, text, font, fill, max_width, line_gap=4):
    x, y = xy
    words = text.split()
    lines = []
    current = ""
    for word in words:
        test = (current + " " + word).strip()
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] - bbox[0] <= max_width or not current:
            current = test
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    for line in lines[:3]:
        draw.text((x, y), line, font=font, fill=fill)
        y += font.size + line_gap
    return y


def make_contact_sheets(records):
    font = get_font(22)
    small_font = get_font(18)
    per_sheet = 12
    cols = 3
    thumb_w = 560
    thumb_h = 440
    label_h = 95
    margin = 24
    gap = 18
    for sheet_idx in range((len(records) + per_sheet - 1) // per_sheet):
        chunk = records[sheet_idx * per_sheet : (sheet_idx + 1) * per_sheet]
        rows = (len(chunk) + cols - 1) // cols
        sheet_w = margin * 2 + cols * thumb_w + (cols - 1) * gap
        sheet_h = margin * 2 + rows * (thumb_h + label_h) + (rows - 1) * gap
        sheet = Image.new("RGB", (sheet_w, sheet_h), "white")
        draw = ImageDraw.Draw(sheet)
        for i, (line_no, rec) in enumerate(chunk):
            col = i % cols
            row = i // cols
            x = margin + col * (thumb_w + gap)
            y = margin + row * (thumb_h + label_h + gap)
            img_path = ROOT / rec["imagePath"]
            with Image.open(img_path) as im:
                im = im.convert("RGB")
                im.thumbnail((thumb_w, thumb_h), Image.Resampling.LANCZOS)
                tx = x + (thumb_w - im.width) // 2
                ty = y + (thumb_h - im.height) // 2
                sheet.paste(im, (tx, ty))
            draw.rectangle([x, y, x + thumb_w, y + thumb_h], outline="black", width=2)
            label = f"{line_no}: {rec['id']} | page {rec['pageNumber']}"
            draw_wrapped(draw, (x, y + thumb_h + 8), label, font, "black", thumb_w)
            block_summary = ", ".join(
                [b["type"] for b in rec.get("teacherOutput", {}).get("blocks", [])[:8]]
            )
            draw_wrapped(
                draw,
                (x, y + thumb_h + 42),
                block_summary,
                small_font,
                "#444444",
                thumb_w,
            )
        out_path = OUT_DIR / f"part3_contact_{sheet_idx + 1}.png"
        sheet.save(out_path)
        print(out_path.relative_to(ROOT))


def write_summary(records):
    lines = []
    for line_no, rec in records:
        layout_path = ROOT / rec["ocrLayoutPath"]
        layout = json.loads(layout_path.read_text(encoding="utf-8"))
        blocks = rec.get("teacherOutput", {}).get("blocks", [])
        type_counts = {}
        for b in blocks:
            type_counts[b["type"]] = type_counts.get(b["type"], 0) + 1
        counts = " ".join(f"{k}:{v}" for k, v in sorted(type_counts.items()))
        lines.append(
            f"{line_no}\t{rec['id']}\tdoc={rec['documentId']}\tpage={rec['pageNumber']}\tlang={rec.get('teacherOutput', {}).get('pageLanguage')}\tblocks={len(blocks)}\tlayoutBlocks={len(layout.get('blocks', []))}\t{counts}"
        )
    out = OUT_DIR / "part3_summary.tsv"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(out.relative_to(ROOT))


if __name__ == "__main__":
    records = load_records()
    print(f"loaded {len(records)} records")
    write_summary(records)
    make_contact_sheets(records)
