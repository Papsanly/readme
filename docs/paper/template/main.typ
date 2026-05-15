#let diploma(
  bibliography-path: "bibliography.yml",
  doc,
) = {
  set page(
    paper: "a4",
    margin: 2cm,
    numbering: (current, ..) => {
      if current > 1 { current }
    },
    number-align: top + right,
  )

  set text(
    font: "Times New Roman",
    size: 14pt,
    lang: "uk",
  )

  set par(
    justify: true,
    first-line-indent: (amount: 1cm, all: true),
    leading: 0.65em,
  )

  show raw: set text(font: "JetBrainsMono NF", size: 10pt)

  // DSTU bullet markers — em-dash for all nesting levels.
  set list(marker: ([–], [–], [–]))

  set heading(numbering: "1.1")

  show heading: set text(size: 14pt, weight: "bold")
  show heading: set block(below: 0.4cm, above: 0.6cm)
  show heading: set par(first-line-indent: 0em)

  show heading.where(level: 1): it => {
    counter(figure.where(kind: image)).update(0)
    counter(figure.where(kind: table)).update(0)
    pagebreak(weak: true)
    align(center, upper(it))
  }

  // Figures and tables — separate counters, both reset at each level-1 heading.
  show figure.where(kind: image): set figure(
    numbering: n => context [#counter(heading).get().first().#n]
  )
  show figure.where(kind: table): set figure(
    numbering: n => context [#counter(heading).get().first().#n]
  )

  show figure.where(kind: table): set figure.caption(position: top)
  show figure.caption.where(kind: table): it => {
    box(width: 1fr, inset: (left: 1cm), align(left, it))
  }
  set figure.caption(separator: [ #sym.dash ])

  show table: it => {
    set table.cell(inset: (x: 6pt, y: 6pt))
    set par(justify: false)
    it
  }

  show figure.where(kind: table): it => {
    set table(align: left)
    set par(justify: false)
    it
  }

  show table: set table.cell(breakable: true)
  show figure: set block(breakable: true)

  show outline.entry.where(level: 1): upper

  set bibliography(
    full: true,
    title: "Список використаних джерел",
    style: "dstu-8302-2015.csl",
  )

  doc
}
