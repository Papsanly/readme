#import "utils.typ": field
#import "../data.typ": faculty, department

// Title page with the ratification block (ЗАТВЕРДЖЕНО / ПОГОДЖЕНО / Нормоконтроль).
// Used for parts that require department head approval — Part 1 (ТЗ) and Part 3 (Текст програми).
#let title-with-cipher(
  title: none,
  subtitle: none,
  cipher: none,
  dept-head-name: none,
  head-name: none,
  norm-control-name: none,
  author-name: none,
  year: none,
) = {
  set par(first-line-indent: 0em, justify: false, leading: 0.7em)

  let placeholder(content) = text(fill: red)[#content]
  let norm-control-display = if norm-control-name == none { placeholder[Ім'я ПРІЗВИЩЕ] } else { norm-control-name }

  align(center)[
    #faculty

    #department
  ]

  v(2em)

  // Right-aligned ratification block: signature + date with inline boxed lines
  pad(left: 50%, align(right)[
    "ЗАТВЕРДЖЕНО"

    Завідувач кафедри

    #field(none, w: 7em) #h(0.5em) #dept-head-name

    "#field(none, w: 1.5em)" #field(none, w: 8em) #year р.
  ])

  v(3em)

  align(center)[
    *#upper(title)*

    *#subtitle*

    #cipher
  ]

  v(2em)

  [
    "ПОГОДЖЕНО"

    Керівник проєкту:

    #field(none, w: 7em) #h(0.5em) #head-name
  ]

  v(2em)

  grid(
    columns: (1fr, 1fr),
    gutter: 1em,
    [
      Нормоконтроль:

      #v(0.3em)
      #box[#field(none, w: 5em) #h(0.4em) #norm-control-display]
    ],
    [
      Виконавець:

      #v(0.3em)
      #box[#field(none, w: 5em) #h(0.4em) #author-name]
    ],
  )

  v(1fr)

  align(center)[Київ #sym.dash.en #year]
}
