#import "utils.typ": field
#import "../data.typ": university-full, institute, faculty, department, speciality

#let title-page(
  course: none,
  group: none,
  author: none,
  term-from-day: none,
  term-from-month: none,
  term-from-year: none,
  term-to-day: none,
  term-to-month: none,
  term-to-year: none,
  base: none,
  base-head-position: none,
  base-head-name: none,
  dept-head-position: none,
  dept-head-name: none,
  year: none,
) = {
  set par(first-line-indent: 0em, justify: false, leading: 0.7em)

  align(center)[
    #university-full

    #institute

    #faculty

    #department
  ]

  v(4em)

  align(center)[
    *ЗВІТ*

    *ПРО ПРОХОДЖЕННЯ ПЕРЕДДИПЛОМНОЇ ПРАКТИКИ*
  ]

  v(1.5em)

  [Студента #field(course) курсу #field(group) групи]

  parbreak()

  [Спеціальності #speciality]

  v(0.5em)

  field(author, w: 100%, caption: [(прізвище, ім'я, по батькові студента)])

  v(0.5em)

  [Термін практики з "#field(term-from-day)" #field(term-from-month) 20#field(term-from-year) р. по "#field(term-to-day)" #field(term-to-month) 20#field(term-to-year) р.]

  parbreak()

  grid(
    columns: (auto, 1fr),
    [База практики:], field(base, w: 100%, caption: [(назва підприємства)]),
  )

  v(1.5em)

  pad(right: 5%, left: 45%)[
    #align(center)[Керівник від підприємства]

    #field(base-head-position, w: 100%, caption: [(науковий ступінь, вчене звання, посада)])

    #field(base-head-name, w: 100%, caption: [(прізвище, ім'я, по батькові, підпис)])

    #v(0.6em)

    #align(center)[Керівник практики від кафедри ІПІ]

    #field(dept-head-position, w: 100%, caption: [(науковий ступінь, вчене звання, посада)])

    #field(dept-head-name, w: 100%, caption: [(прізвище, ім'я, по батькові, підпис)])
  ]

  v(1fr)

  align(center)[*Київ-20#field(year) р.*]
}
