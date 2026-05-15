#let field(content, w: none, caption: none) = {
  let small = text.with(size: 10pt, style: "italic")
  let is-empty(c) = c == none or c == "" or c == []

  if w == none {
    // inline: underline that hugs text width; nothing if empty
    if not is-empty(content) {
      underline(stroke: 1pt + black, offset: 4pt, evade: false)[#content]
    }
  } else if caption == none {
    // inline-block: fixed width box with line under content
    box(
      width: w,
      outset: (bottom: 4pt),
      stroke: (bottom: 1pt + black),
      if is-empty(content) [] else [#align(center, content)],
    )
  } else {
    // block: content centered above full line, then italic caption below
    stack(
      dir: ttb,
      spacing: 4pt,
      align(center, if is-empty(content) [] else { content }),
      line(length: w, stroke: 1pt + black),
    )
    block(above: 2pt, width: 100%, align(center, small[#caption]))
  }
}

// Read a slice of a source file and render as a syntax-highlighted code block.
// `from` and `to` are 1-based inclusive line numbers (typst absolute path,
// resolved from project root).
#let code-from-file(path, lang: "typescript", from: 1, to: none) = {
  let lines = read(path).split("\n")
  let end = if to == none { lines.len() } else { to }
  raw(
    block: true,
    lang: lang,
    lines.slice(from - 1, end).join("\n"),
  )
}

