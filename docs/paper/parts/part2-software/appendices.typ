#{
  set heading(numbering: none)
  heading(level: 1)[Додатки]
}

Тексти програмного коду наведені в окремому документі «Текст програми» (КПІ.ІП-1119.045440.03.12 — частина 3 дипломного проєкту).

Графічні матеріали (бізнес-процес створення аудіоозвучення документа, діаграма варіантів використання, контекстна діаграма C4 Level 1, діаграма контейнерів C4 Level 2, діаграма компонентів серверної частини C4 Level 3, діаграма розгортання) винесено в окремий комплект графічної частини проєкту на аркушах формату A3.

Оформлення пояснювальної записки виконано відповідно до вимог @dstu-3008-2015 щодо структури та правил оформлювання звітів у сфері науки і техніки; бібліографічні посилання оформлено за @dstu-8302-2015.

#pagebreak()
#{
  set par(first-line-indent: 0em, justify: false)

  align(center)[
    #text(weight: "bold")[ДОДАТОК А]
    #linebreak()
    #text(weight: "bold")[ЗВІТ ПОДІБНОСТІ]
  ]
}

#pagebreak()
#{
  set page(width: 8.5in, height: 11in, margin: 0pt, numbering: none)
  set par(first-line-indent: 0em, justify: false)

  for page-no in range(1, 5) {
    box(
      width: 100%,
      height: 100%,
      image(
        "/docs/paper/assets/plagiarism/plagiarism-" + str(page-no) + ".png",
        width: 100%,
        height: 100%,
        fit: "cover",
      ),
    )

    if page-no < 4 {
      pagebreak()
    }
  }
}
