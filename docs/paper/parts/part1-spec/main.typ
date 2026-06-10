#import "../../template/utils.typ": diploma-outline

// Part 1 (ТЗ) — labels bound the scope so the outline picks only this part.
#[
  #metadata("part1-tz-start")<part1-tz-start>

  // Зміст
  #{
    set heading(numbering: none, outlined: false)
    show heading: set align(center)
    heading(level: 1)[Зміст]
  }

  #diploma-outline(heading.where(outlined: true).after(<part1-tz-start>).before(<part1-tz-end>))

  #include "1-scope.typ"
  #include "2-basis.typ"
  #include "3-purpose.typ"
  #include "4-requirements.typ"
  #include "5-docs.typ"
  #include "6-stages.typ"
  #include "7-control.typ"

  #metadata("part1-tz-end")<part1-tz-end>
]
