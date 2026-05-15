#let title-part2-software(
  title: none,
  cipher: none,
  year: none,
) = {
  set par(first-line-indent: 0em, justify: false, leading: 0.7em)

  v(15em)

  align(center)[
    *Пояснювальна записка*

    *до дипломного проєкту*
  ]

  v(1em)

  [на тему: *#underline[#title]*]

  v(2em)

  align(center)[#cipher]

  v(1fr)

  align(center)[Київ #sym.dash.en #year]
}
