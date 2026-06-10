#import "utils.typ": field

#let title-part2-software(
  title: none,
  cipher: none,
  year: none,
) = {
  set par(first-line-indent: 0em, justify: false, leading: 0.7em, spacing: 1.2em)

  v(15em)

  align(center)[
    #text(size: 18pt, weight: "bold")[Пояснювальна записка]

    #text(size: 16pt, weight: "bold")[до дипломного проєкту]
  ]

  v(1em)

  [на тему: *#field(title)*]

  v(2em)

  align(center)[#cipher]

  v(1fr)

  align(center)[Київ #sym.dash.en #year]
}
