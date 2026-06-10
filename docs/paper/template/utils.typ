#let field(content, w: none, caption: none) = {
  let small = text.with(size: 10pt, style: "italic")
  let is-empty(c) = c == none or c == "" or c == []

  if w == none {
    // inline: underline that hugs text width; nothing if empty
    if not is-empty(content) {
      underline(stroke: 0.5pt + black, offset: 4pt, evade: false)[#content]
    }
  } else if caption == none {
    // inline-block: fixed width box with line under content
    box(
      width: w,
      outset: (bottom: 4pt),
      stroke: (bottom: 0.5pt + black),
      if is-empty(content) [] else [#align(center, content)],
    )
  } else {
    // block: reserve one text row above the line even for empty fields,
    // so empty signature fields align with filled fields. Caption stays below.
    let content-part = box(
      width: w,
      height: 1em,
      if is-empty(content) { [] } else { align(center + bottom, content) },
    )
    let line-part = line(length: w, stroke: 0.5pt + black)
    let caption-part = box(width: w, align(center, small[#caption]))

    box(
      width: w,
      stack(
        dir: ttb,
        spacing: 2pt,
        content-part,
        line-part,
        caption-part,
      ),
    )
  }
}

#let diploma-outline(target) = {
  set par(
    first-line-indent: 0em,
    justify: false,
    leading: 1.2em,
    spacing: 1.2em,
  )

  outline(
    title: none,
    indent: 0pt,
    target: target,
  )
}

// Read a slice of a source file and render as a syntax-highlighted code block.
// `from` and `to` are 1-based inclusive line numbers (typst absolute path,
// resolved from project root).
#let code-from-file(path, lang: "typescript", from: 1, to: none) = {
  let lines = read(path).split("\n")
  let end = if to == none { lines.len() } else { to }

  set par(
    first-line-indent: 0em,
    justify: false,
    leading: 0.65em,
    spacing: 1.2em,
  )

  raw(
    block: true,
    lang: lang,
    lines.slice(from - 1, end).join("\n"),
  )
}
