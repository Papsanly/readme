#import "../../data.typ": *
#import "../../template/utils.typ": field

#let graphic-title() = [
  #set page(numbering: none, margin: 2cm)
  #set text(size: 14pt)
  #set par(first-line-indent: 0em, justify: false, leading: 0.7em)

  #align(center)[
    #faculty

    #department
  ]

  #v(2em)

  #pad(left: 52%, align(right)[
    "ЗАТВЕРДЖЕНО"

    Завідувач кафедри

    #field(none, w: 7em) #h(0.5em) #dept-head-name

    “#field(none, w: 1.5em)” #field(none, w: 8em) #year р.
  ])

  #v(8em)

  #align(center)[
    #text(weight: "bold")[#upper(title)]

    #text(weight: "bold")[Графічний матеріал]

    #cipher-graphic
  ]

  #v(8em)

  #block[
    "ПОГОДЖЕНО"

    Керівник проєкту:

    #field(none, w: 7em) #h(0.5em) Микола ХРАМЧЕНКО
  ]

  #v(2.5em)

  #grid(
    columns: (1fr, 1fr),
    gutter: 2em,
    [
      Нормоконтроль:

      #v(0.3em)
      #field(none, w: 5em) #h(0.5em) Тетяна ШУЛЬКЕВИЧ
    ],
    [
      Виконавець:

      #v(0.3em)
      #field(none, w: 5em) #h(0.5em) Андрій ЛИСЕНКО
    ],
  )

  #v(1fr)

  #align(center)[Київ – #year]
]

#let stamp(sheet-title, sheet: "1", total: "6") = {
  let small = text.with(size: 7pt)
  table(
    columns: (auto, auto, 2.4cm, auto, auto, 8.8cm, 0.45cm, 0.45cm, 0.45cm, auto, auto),
    rows: (0.4cm,) * 11,
    inset: 2pt,
    stroke: 1pt,
    align: center + horizon,

    // Empty revision rows above the signature header.
    ..range(4).map(y => range(5).map(x => table.cell(x: x, y: y)[])).flatten(),

    table.cell(x: 0, y: 4)[#small[Зм.]],
    table.cell(x: 1, y: 4)[#small[Арк.]],
    table.cell(x: 2, y: 4)[#small[№ докум.]],
    table.cell(x: 3, y: 4)[#small[Підп.]],
    table.cell(x: 4, y: 4)[#small[Дата]],

    table.cell(x: 0, y: 5, colspan: 2)[#small[Розробив]],
    table.cell(x: 2, y: 5)[#small[Лисенко А. Ю.]],
    table.cell(x: 3, y: 5)[],
    table.cell(x: 4, y: 5)[],

    table.cell(x: 0, y: 6, colspan: 2)[#small[Перевірив]],
    table.cell(x: 2, y: 6)[#small[Храмченко М. С.]],
    table.cell(x: 3, y: 6)[],
    table.cell(x: 4, y: 6)[],

    table.cell(x: 0, y: 7, colspan: 2)[#small[Т. контр.]],
    table.cell(x: 2, y: 7)[],
    table.cell(x: 3, y: 7)[],
    table.cell(x: 4, y: 7)[],

    table.cell(x: 0, y: 8, colspan: 2)[],
    table.cell(x: 2, y: 8)[],
    table.cell(x: 3, y: 8)[],
    table.cell(x: 4, y: 8)[],

    table.cell(x: 0, y: 9, colspan: 2)[#small[Н. контр.]],
    table.cell(x: 2, y: 9)[#small[Шулькевич Т. В.]],
    table.cell(x: 3, y: 9)[],
    table.cell(x: 4, y: 9)[],

    table.cell(x: 0, y: 10, colspan: 2)[#small[Затвердив]],
    table.cell(x: 2, y: 10)[#small[Жаріков Е. В.]],
    table.cell(x: 3, y: 10)[],
    table.cell(x: 4, y: 10)[],

    table.cell(x: 5, y: 0, colspan: 6, rowspan: 3, align: center + horizon)[#text(size: 10pt)[#cipher-graphic]],
    table.cell(x: 5, y: 3, rowspan: 5, align: center + horizon)[#text(size: 9pt)[#sheet-title]],

    table.cell(x: 6, y: 3, colspan: 3)[#small[Літ.]],
    table.cell(x: 9, y: 3)[#small[Маса]],
    table.cell(x: 10, y: 3)[#small[Масштаб]],
    table.cell(x: 6, y: 4, rowspan: 2)[],
    table.cell(x: 7, y: 4, rowspan: 2)[],
    table.cell(x: 8, y: 4, rowspan: 2)[],
    table.cell(x: 9, y: 4, rowspan: 2)[],
    table.cell(x: 10, y: 4, rowspan: 2)[],

    table.cell(x: 6, y: 6, colspan: 4)[#small[Аркуш]],
    table.cell(x: 10, y: 6)[#small[Аркушів]],
    table.cell(x: 6, y: 7, colspan: 4)[#small[#sheet]],
    table.cell(x: 10, y: 7)[#small[#total]],

    table.cell(x: 5, y: 8, rowspan: 3, align: center + horizon)[#text(size: 8pt)[#title]],
    table.cell(
      x: 6,
      y: 8,
      colspan: 5,
      rowspan: 3,
      align: center + horizon,
    )[#small[КПІ ім. Ігоря Сікорського\ ФІОТ каф. ІПІ гр. ІП-24]],
  )
}

#let graphic-sheet(path, name, sheet: "1", total: "6") = [
  #set page(width: 297mm, height: 420mm, margin: 10mm, numbering: none)
  #set text(size: 12pt)
  #set par(first-line-indent: 0em, justify: false)

  #let top-code-height = 1cm
  #let stamp-height = 4.4cm
  #let drawing-padding = 0.7cm
  #let drawing-area-height = 40cm - top-code-height - stamp-height

  #box(
    width: 100%,
    height: 100%,
    stroke: 2pt + black,
    inset: 0pt,
    [
      #place(top + left)[#box(
        width: 5.6cm,
        height: 1cm,
        stroke: 2pt + black,
        inset: 0pt,
        align(center + horizon, rotate(180deg, reflow: true)[#text(size: 10pt)[#cipher-graphic]]),
      )]
      #place(top + left, dy: top-code-height)[#box(
        width: 100%,
        height: drawing-area-height,
        inset: drawing-padding,
        align(center + horizon, image(
          path,
          width: 100%,
          height: 100%,
          fit: "contain",
        )),
      )]
      #place(bottom + right)[#stamp(name, sheet: sheet, total: total)]
    ],
  )
]

#let graphics = (
  (path: "/docs/paper/assets/bpmn.svg", name: [Бізнес-процес створення аудіоозвучення документа]),
  (path: "/docs/paper/assets/use-case.png", name: [Діаграма варіантів використання]),
  (path: "/docs/paper/assets/c4-l1.png", name: [Контекстна діаграма (C4 Level 1)]),
  (path: "/docs/paper/assets/c4-l2.png", name: [Діаграма контейнерів (C4 Level 2)]),
  (path: "/docs/paper/assets/c4-l3.png", name: [Діаграма компонентів серверної частини (C4 Level 3)]),
  (path: "/docs/paper/assets/deployment.png", name: [Діаграма розгортання]),
)

#graphic-title()
#pagebreak()
#for (i, item) in graphics.enumerate() {
  graphic-sheet(item.path, item.name, sheet: str(i + 1), total: str(graphics.len()))
  if i + 1 < graphics.len() {
    pagebreak()
  }
}
