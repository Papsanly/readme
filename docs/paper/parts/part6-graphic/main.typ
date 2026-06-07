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

#let stamp(title, sheet: "1", total: "6") = table(
  columns: (1.2cm, 1.2cm, 2.7cm, 1.3cm, 1.3cm, 7cm, 1.2cm, 1.2cm, 1.7cm, 1.7cm),
  rows: (0.7cm, 0.7cm, 0.7cm, 0.7cm, 0.7cm),
  inset: 3pt,
  stroke: 1pt,
  align: center + horizon,
  text(size: 8pt)[Змін.],
  text(size: 8pt)[Арк.],
  text(size: 8pt)[№ докум.],
  text(size: 8pt)[Підп.],
  text(size: 8pt)[Дата],
  table.cell(colspan: 5, rowspan: 2, align: center + horizon)[#cipher-graphic],

  text(size: 8pt)[Розроб.],
  text(size: 8pt)[Лисенко А. Ю.],
  [],
  [],
  [],

  text(size: 8pt)[Перевір.],
  text(size: 8pt)[Храмченко М. С.],
  [],
  [],
  [],
  table.cell(colspan: 2, rowspan: 3, align: center + horizon)[#text(size: 9pt)[#title]],
  text(size: 8pt)[Літ.],
  text(size: 8pt)[Аркуш],
  text(size: 8pt)[Аркушів],

  text(size: 8pt)[Н. контр.],
  text(size: 8pt)[Шулькевич Т. В.],
  [],
  [],
  [],
  [],
  text(size: 8pt)[#sheet],
  text(size: 8pt)[#total],

  text(size: 8pt)[Затв.],
  text(size: 8pt)[Жаріков Е. В.],
  [],
  [],
  [],
  table.cell(colspan: 3, align: center + horizon)[#text(size: 8pt)[КПІ ім. Ігоря Сікорського\ ФІОТ каф. ІПІ гр. ІП-24]],
)

#let graphic-sheet(path, name, sheet: "1", total: "6") = [
  #set page(width: 297mm, height: 420mm, margin: 10mm, numbering: none)
  #set text(size: 12pt)
  #set par(first-line-indent: 0em, justify: false)

  #let top-code-height = 1cm
  #let stamp-height = 3.5cm
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
