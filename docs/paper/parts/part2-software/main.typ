// Part 2 (ПЗ) — labels bound the scope so the outline picks only this part.
#let render-part2-software(
  include-references: true,
  include-appendices: true,
) = [
  #metadata("part2-pz-start")<part2-pz-start>

  // Зміст
  #{
    set heading(numbering: none, outlined: false)
    show heading: set align(center)
    heading(level: 1)[Зміст]
  }

  #outline(
    title: none,
    target: heading.where(outlined: true).after(<part2-pz-start>).before(<part2-pz-end>),
  )

  #include "abbreviations.typ"
  #include "introduction.typ"
  #include "1-survey.typ"
  #include "2-requirements.typ"
  #include "3-construction.typ"
  #include "4-quality.typ"
  #include "5-deployment.typ"
  #include "conclusions.typ"

  #if include-references {
    include "references.typ"
  }

  #if include-appendices {
    include "appendices.typ"
  }

  #metadata("part2-pz-end")<part2-pz-end>
]

#render-part2-software()
