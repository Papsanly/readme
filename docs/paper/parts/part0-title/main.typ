#import "../../data.typ": *
#import "../../template/utils.typ": field

#let pz-headings() = query(
  heading.where(level: 1, outlined: true).after(<part2-content-start>).before(<part2-content-end>),
)
#let pz-section-headings() = pz-headings().filter(h => h.numbering != none)
#let pz-section-count() = context pz-section-headings().len()
#let pz-section-number-list() = context range(1, pz-section-headings().len() + 1).map(str).join(", ")
#let pz-table-count() = context query(
  figure.where(kind: table).after(<part2-content-start>).before(<part2-content-end>),
).len()
#let pz-image-count() = context query(
  figure.where(kind: image).after(<part2-content-start>).before(<part2-content-end>),
).len()

#let pz-section-list() = context {
  for (i, h) in pz-headings().enumerate() {
    field(box(width: 100%, align(left, [#(i + 1)) #h.body])), w: 100%)
    linebreak()
  }
}

#let graphic-material-list() = context {
  let figs = query(figure.where(kind: image).after(<part2-content-start>).before(<part2-content-end>))
  for (i, f) in figs.enumerate() {
    field(box(width: 100%, align(left, [#(i + 1)) #f.caption.body])), w: 100%)
    linebreak()
  }
}

#let title-main() = [
  #set page(numbering: none, margin: (x: 2cm, y: 1.45cm))
  #set text(size: 13.5pt)

  #align(center)[
    НАЦІОНАЛЬНИЙ ТЕХНІЧНИЙ УНІВЕРСИТЕТ УКРАЇНИ\
    «КИЇВСЬКИЙ ПОЛІТЕХНІЧНИЙ ІНСТИТУТ імені ІГОРЯ СІКОРСЬКОГО»\
    #field(faculty, w: 10.5cm, caption: [(повна назва інституту/факультету)])
    #field(department, w: 9.5cm, caption: [(повна назва кафедри)])
  ]

  #v(0.7em)

  #grid(
    columns: (1fr, auto),
    [],
    [
      #set par(spacing: 5pt)
      «До захисту допущено»\
      Завідувач кафедри \
      #field(none, w: 6em, caption: [(підпис)]) #h(0.4em) #field(dept-head-name, w: 9em, caption: [(ім'я прізвище)]) \
      “#field(none, w: 1.5em)” #field(none, w: 8em) #year р.
    ],
  )

  #v(0.8em)

  #align(center)[
    #text(size: 20pt, weight: "bold")[Дипломний проект]\
    #text(weight: "bold")[на здобуття ступеня бакалавра]\
    #text(weight: "bold")[за освітньо-професійною програмою «Інженерія програмного забезпечення інформаційних систем»]\
    #text(weight: "bold")[спеціальності «#speciality»]
  ]

  #v(0.9em)

  #grid(
    columns: (3cm, 1fr, 3.2cm),
    rows: (1.05cm,) * 6,
    column-gutter: 0.45cm,
    row-gutter: 0em,
    [на тему:],
    grid.cell(colspan: 2)[#field(title, w: 100%)],

    grid.cell(rowspan: 2)[Виконав],
    [#field([студент IV курсу, групи #group], w: 100%)],
    [],
    [#field(author-full, w: 100%, caption: [(прізвище, ім'я, по батькові)])],
    [#field(none, w: 3.2cm, caption: [(підпис)])],

    [Керівник],
    [#field(
      [асистент, Храмченко М. С.],
      w: 100%,
      caption: [(посада, науковий ступінь, вчене звання, прізвище та ініціали)],
    )],
    [#field(none, w: 3.2cm, caption: [(підпис)])],

    [Консультант],
    [#field(
      [асистент, Шулькевич Т. В.],
      w: 100%,
      caption: [(посада, науковий ступінь, вчене звання, прізвище та ініціали)],
    )],
    [#field(none, w: 3.2cm, caption: [(підпис)])],

    [Рецензент],
    [#field(none, w: 100%, caption: [(посада, науковий ступінь, вчене звання, прізвище та ініціали)])],
    [#field(none, w: 3.2cm, caption: [(підпис)])],
  )

  #v(1em)

  #grid(
    columns: (1fr, auto),
    [],
    [
      #set par(justify: true)
      Засвідчую, що у цьому дипломному проекті\
      немає запозичень з праць інших авторів без\
      відповідних посилань.
      #v(0.4em)
      #grid(
        columns: (auto, 4cm),
        column-gutter: 0.8em,
        [Студент], [#field(none, w: 4cm, caption: [(підпис)])],
      )
    ],
  )

  #v(1fr)
  #align(center)[Київ – #year]
]

#let task-pages() = [
  #set page(numbering: none, margin: (x: 2cm, y: 1.45cm))
  #set text(size: 13.5pt)

  #align(center)[
    Національний технічний університет України\
    «Київський політехнічний інститут імені Ігоря Сікорського»
  ]
  #faculty\
  #department\
  Рівень вищої освіти – перший (бакалаврський)\
  Спеціальність – #speciality\
  Освітньо-професійна програма – Інженерія програмного забезпечення інформаційних систем

  #v(0.9em)
  #grid(
    columns: (1fr, auto),
    [],
    [
      #stack(
        dir: ttb,
        spacing: 0.5em,
        [ЗАТВЕРДЖУЮ],
        [Завідувач кафедри],
        [#grid(
          columns: (4.5em, 0.7em, 9em),
          [#field(none, w: 4.5em, caption: [(підпис)])],
          [],
          [#field(dept-head-name, w: 9em, caption: [(ім'я прізвище)])],
        )],
        [#block(above: 0.45em)[“#field(none, w: 1.5em)” #field(none, w: 7em) #year р.]],
      )
    ],
  )

  #v(1em)
  #align(center)[
    #text(weight: "bold")[ЗАВДАННЯ]\
    #text(weight: "bold")[на дипломний проект студенту]
  ]
  #align(center)[#field(author-full, w: 100%, caption: [(прізвище, ім'я, по батькові)])]

  #v(0.8em)
  #grid(
    columns: (auto, 1fr),
    inset: 5pt,
    [1. Тема проєкту#h(0.6em)], [#field(box(width: 100%, align(left, title)), w: 100%)],
    block(inset: (top: 0.3em))[керівник проєкту#h(0.6em)],
    [#field(
      align(left, [асистент, Храмченко М. С.]),
      w: 100%,
      caption: [(прізвище, ім'я, по батькові, науковий ступінь, вчене звання)],
    )],
  )

  затверджені наказом по університету від “#field(none, w: 1.5em)” #field(none, w: 5em) #year р. №#field(none, w: 5em)

  2. Термін подання студентом проекту “13” червня #year року

  3. Вихідні дані до проекту: #field([технічне завдання])

  4. Зміст пояснювальної записки

  #pz-section-list()

  #pagebreak()

  5. Перелік графічного матеріалу

  #graphic-material-list()

  6. Консультанти розділів проекту

  #text(size: 10.5pt)[
    #table(
      columns: (3cm, 1fr, 2.5cm, 2.5cm),
      align: center + horizon,
      table.header(
        table.cell(rowspan: 2)[Розділ],
        table.cell(rowspan: 2)[Прізвище, ініціали та посада консультанта],
        table.cell(colspan: 2)[Підпис, дата],
        [завдання видав],
        [завдання прийняв],
      ),
      [#pz-section-number-list()], [асистент, Храмченко М. С.], [ ], [ ],
    )
  ]

  7. Дата видачі завдання "15" березня #year року

  #align(center)[Календарний план]

  #text(size: 10.5pt)[
    #table(
      columns: (auto, 1fr, 3.4cm, 2.1cm),
      align: center + horizon,
      table.header(
        [№\ з/п],
        [#stack(dir: ttb, spacing: 2pt, align(center, [Назва етапів виконання]), align(center, [дипломного проекту]))],
        [#stack(dir: ttb, spacing: 2pt, align(center, [Термін виконання]), align(center, [етапів проекту]))],
        [Примітка],
      ),
      [1], [Вивчення рекомендованої літератури], [15.03.#year], [],
      [2], [Аналіз існуючих методів розв'язання задачі], [22.03.#year], [],
      [3], [Постановка та формалізація задачі], [29.03.#year], [],
      [4], [Розробка інформаційного забезпечення], [12.04.#year], [],
      [5], [Алгоритмізація задачі], [26.04.#year], [],
      [6], [Обґрунтування вибору використаних технічних засобів], [03.05.#year], [],
      [7], [Розробка програмного забезпечення], [17.05.#year], [],
      [8], [Налагодження програми], [24.05.#year], [],
      [9], [Виконання графічних документів], [29.05.#year], [],
      [10], [Оформлення пояснювальної записки], [01.06.#year], [],
      [11], [Подання ДП на попередній захист], [02.06.#year], [],
      [12], [Подання ДП рецензенту], [10.06.#year], [],
      [13], [Подання ДП на основний захист], [13.06.#year], [],
    )
  ]

  #v(1em)
  #grid(
    columns: (auto, 1fr, 4cm, 1fr, auto),
    row-gutter: 0.8em,
    [Студент],
    [],
    [#field(none, w: 4cm, caption: [(підпис)])],
    [],
    [#field(author-short, w: 6cm, caption: [(ініціали, прізвище)])],

    [Керівник],
    [],
    [#field(none, w: 4cm, caption: [(підпис)])],
    [],
    [#field(head-name, w: 6cm, caption: [(ініціали, прізвище)])],
  )
]

#let diploma-doc-metas() = query(metadata).filter(m => (
  type(m.value) == dictionary and m.value.kind == "diploma-doc-start"
))
#let diploma-doc-end(id) = (
  query(metadata)
    .filter(m => type(m.value) == dictionary and m.value.kind == "diploma-doc-end" and m.value.id == id)
    .at(0, default: none)
)
#let diploma-doc-pages(doc) = {
  let end = diploma-doc-end(doc.value.id)
  if end == none {
    ""
  } else {
    let start-page = doc.location().page()
    let end-page = end.location().page()
    let pages = calc.abs(end-page - start-page) + 1
    str(if doc.value.id == "graphic" { pages - 1 } else { pages })
  }
}
#let diploma-doc-by-id(id) = diploma-doc-metas().filter(doc => doc.value.id == id).at(0, default: none)
#let diploma-pages-by-id(id) = context {
  let doc = diploma-doc-by-id(id)
  if doc == none { "" } else { diploma-doc-pages(doc) }
}

#let annotation-pages() = [
  #set page(numbering: none)
  #let sources-count = yaml("../../template/bibliography.yml").len()

  #align(center)[#text(weight: "bold")[АНОТАЦІЯ]]

  Пояснювальна записка дипломного проекту складається з #pz-section-count() розділів, містить #pz-table-count() таблиць, #pz-image-count() рисунків, #sources-count використаних джерел та додатки — загалом #diploma-pages-by-id("pz") сторінок.

  Дипломний проект присвячено розробленню мобільного застосунку ReadMe для перетворення документів довільних форматів на аудіокниги з використанням методів штучного інтелекту. Актуальність роботи зумовлена потребою у зручному прослуховуванні наукових статей, сканованих книг та інших документів зі складною просторовою структурою, для яких традиційний каскад OCR + TTS часто озвучує службові елементи сторінки та не виконує семантичної підготовки тексту до мовлення.

  У роботі проаналізовано предметну область та існуючі програмні рішення, сформульовано функціональні й нефункціональні вимоги, спроектовано архітектуру системи та реалізовано мобільний клієнт на React Native й Expo. Основою розробки є VLM-centric pipeline, у якому vision-language модель використовується як семантичний шар між OCR-розміткою документа та TTS-синтезом. Реалізовано імпорт документів різних форматів, потокову обробку сторінок, ранній початок прослуховування після готовності першої сторінки, кешування аудіофрагментів, режими перегляду reflowed/original, налаштування голосу й швидкості, пропуск службових блоків, офлайн-завантаження, резервне копіювання бібліотеки та інтеграцію з TTS-провайдерами.

  Окрему увагу приділено серверній та ML-підсистемам: описано взаємодію мобільного клієнта з Node.js-сервером, OCR/VLM-компонентами, локальним файловим сховищем і сервісами синтезу мовлення. Для зменшення вартості та затримки інференсу розглянуто teacher–student підхід і дистиляцію великої VLM у меншу спеціалізовану модель. Проведено тестування ключових сценаріїв застосунку, зокрема імпорту, обробки документів, відтворення аудіо, перемикання режимів перегляду, роботи з налаштуваннями, резервного копіювання та обробки помилок.

  Результатом дипломного проекту є працездатний мобільний застосунок, що забезпечує більш природне перетворення документів на аудіокниги порівняно з прямим озвученням OCR-тексту та може бути використаний для індивідуального прослуховування довгого текстового контенту.

  КЛЮЧОВІ СЛОВА: МОБІЛЬНИЙ ЗАСТОСУНОК, АУДІОКНИГА, OCR, VLM, TTS, ШТУЧНИЙ ІНТЕЛЕКТ, REACT NATIVE, EXPO, СЕМАНТИЧНА ОБРОБКА ДОКУМЕНТІВ.

  #pagebreak()

  #align(center)[#text(weight: "bold")[ABSTRACT]]

  The explanatory note of the diploma project consists of #pz-section-count() sections and contains #pz-table-count() tables, #pz-image-count() figures, #sources-count references and appendices — #diploma-pages-by-id("pz") pages in total.

  The diploma project is devoted to the development of ReadMe, a mobile application for converting documents of various formats into audiobooks using artificial intelligence methods. The relevance of the project is determined by the need for comfortable audio consumption of scientific papers, scanned books and other documents with complex spatial layouts, where a traditional OCR + TTS pipeline often reads page service elements aloud and does not prepare the text semantically for narration.

  The work analyzes the problem domain and existing software solutions, defines functional and non-functional requirements, designs the system architecture and implements a mobile client based on React Native and Expo. The core of the solution is a VLM-centric pipeline in which a vision-language model acts as a semantic layer between document OCR markup and TTS synthesis. The implemented application supports importing documents in multiple formats, streaming page processing, early playback after the first page is ready, audio fragment caching, reflowed and original viewing modes, voice and speed settings, skipping service blocks, offline preloading, library backup and integration with TTS providers.

  Special attention is paid to the server and ML subsystems: the project describes the interaction between the mobile client, the Node.js server, OCR/VLM components, local file storage and speech synthesis services. To reduce inference cost and latency, the project considers a teacher–student approach and distillation of a large VLM into a smaller specialized model. The main application scenarios were tested, including document import, processing, audio playback, view mode switching, settings management, backup and error handling.

  The result of the diploma project is a working mobile application that provides a more natural conversion of documents into audiobooks compared with direct OCR text narration and can be used for individual listening to long-form textual content.

  KEYWORDS: MOBILE APPLICATION, AUDIOBOOK, OCR, VLM, TTS, ARTIFICIAL INTELLIGENCE, REACT NATIVE, EXPO, SEMANTIC DOCUMENT PROCESSING.
]

#let small = content => {
  text(size: 9pt)[#content]
}

#let graphic-material(body, data: (), author: "", code: "") = {
  set page(margin: 2cm)
  set text(size: 12pt)

  table(
    columns: 11,
    inset: (_, y) => if y > 24 { 5pt } else { 7pt },
    align: (x, y) => if y == 0 { center + horizon } else { horizon },
    stroke: (x, y) => (
      top: if y == 0 or y > 24 { 2pt } else { 0.5pt },
      bottom: 2pt,
      left: if x == 0 or y > 24 { 2pt } else { 0.5pt },
      right: 2pt,
    ),

    table.header(
      rotate(-90deg, reflow: true)[№ з/п],
      rotate(-90deg, reflow: true)[Формат],
      table.cell(colspan: 3)[Позначення],
      table.cell(colspan: 4)[Найменування],
      rotate(-90deg, reflow: true)[Кількість\ листів],
      [Примітка],
    ),

    ..data
      .chunks(6)
      .map(d => (
        table.cell(align: center + horizon, d.at(0)),
        table.cell(align: center + horizon, d.at(1)),
        table.cell(colspan: 3, d.at(2)),
        table.cell(colspan: 4, d.at(3)),
        table.cell(align: center + horizon, d.at(4)),
        d.at(5),
      ))
      .flatten(),

    ..range(17)
      .map(_ => (
        box(height: 7pt),
        [],
        table.cell(colspan: 3)[],
        table.cell(colspan: 4)[],
        [],
        [],
      ))
      .flatten(),

    box(height: 7pt),
    [],
    [],
    [],
    [],
    table.cell(
      colspan: 6,
      rowspan: 3,
      align: center + horizon,
      text(size: 11pt, code),
    ),

    table.hline(stroke: 1pt),
    box(height: 7pt),
    [],
    [],
    [],
    [],

    small[Змін.],
    small[Арк.],
    small[№ докум.],
    small[Підп.],
    small[Дата],

    table.cell(colspan: 2, small[Розроб.]),
    small(author),
    [],
    [],
    table.cell(
      rowspan: 5,
      align: center + horizon,
      box(width: 1fr, small[Відомість дипломного проєкту]),
    ),
    table.cell(colspan: 3, align: center + horizon, small[Літ.]),
    table.cell(align: center + horizon, small[Аркуш]),
    table.cell(align: center + horizon, small[Аркушів.]),

    table.hline(stroke: 1pt, end: 5),
    table.cell(colspan: 2, small[Перевір.]),
    small[Храмченко М. С.],
    [],
    [],
    box(width: 4pt),
    table.vline(stroke: 1pt),
    box(width: 4pt),
    table.vline(stroke: 1pt),
    box(width: 4pt),
    table.cell(align: center + horizon, small[1]),
    table.cell(align: center + horizon, small[1]),

    table.hline(stroke: 1pt, end: 5),
    table.cell(colspan: 2, box(height: 7pt)),
    [],
    [],
    [],
    table.cell(
      colspan: 5,
      rowspan: 3,
      align: center + horizon,
      small[КПІ ім. Ігоря Сікорського\ ФІОТ каф. ІПІ гр. ІП-24],
    ),

    table.hline(stroke: 1pt),
    table.cell(colspan: 2, small[Н. контр.]),
    small[Шулькевич Т. В.],
    [],
    [],

    table.hline(stroke: 1pt),
    table.cell(colspan: 2, small[Затв.]),
    small[Жаріков Е. В.],
    [],
    [],
  )
}

#let diploma-statement() = {
  graphic-material(
    [],
    code: cipher-vedomist,
    author: "Лисенко А. Ю.",
    data: (
      // row 1
      [1],
      [А4],
      [],
      [Завдання на дипломний проєкт],
      [#diploma-pages-by-id("task")],
      [],
      // row 2
      [2],
      [А4],
      [#cipher-tz],
      [Технічне завдання],
      [#diploma-pages-by-id("tz")],
      [],
      // row 3
      [3],
      [А4],
      [#cipher-pz],
      [Пояснювальна записка],
      [#diploma-pages-by-id("pz")],
      [],
      // row 4
      [4],
      [А4],
      [#cipher-tp],
      [Текст програми],
      [#diploma-pages-by-id("tp")],
      [],
      // row 5
      [5],
      [А4],
      [#cipher-pmt],
      [Програма та методика тестування],
      [#diploma-pages-by-id("pmt")],
      [],
      // row 6
      [6],
      [А4],
      [#cipher-kk],
      [Керівництво користувача],
      [#diploma-pages-by-id("kk")],
      [],
      [7],
      [А3],
      [#cipher-graphic],
      [Графічний матеріал],
      [#diploma-pages-by-id("graphic")],
      [],
    ),
  )
}

#{
  set par(first-line-indent: 0em, justify: false)

  title-main()
  pagebreak()
  metadata((kind: "diploma-doc-start", id: "task", format: "A4", mark: "", name: "Завдання на дипломний проект"))
  task-pages()
  metadata((kind: "diploma-doc-end", id: "task"))
  pagebreak()
  annotation-pages()
  pagebreak()
  diploma-statement()
}
