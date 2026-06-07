#import "template/main.typ": diploma
#import "template/title-with-cipher.typ": title-with-cipher
#import "template/title-part2-software.typ": title-part2-software
#import "data.typ": *

#show: diploma

#let reset-document-counters() = {
  counter(heading).update(0)
  counter(figure.where(kind: image)).update(0)
  counter(figure.where(kind: table)).update(0)
}

#let start-part(first: false) = {
  if not first {
    pagebreak(weak: true)
  }
  reset-document-counters()
}

#let title-page(body) = {
  {
    set page(numbering: none)
    body
  }
  pagebreak(weak: true)
  counter(page).update(2)
}

// 0. Титульні сторінки, завдання, анотації та відомість
#include "parts/part0-title/main.typ"

// 1. Технічне завдання
#start-part()
#metadata((kind: "diploma-doc-start", id: "tz", format: "A4", mark: cipher-tz, name: "Технічне завдання"))
#title-page(title-with-cipher(
  title: title,
  subtitle: "Технічне завдання",
  cipher: cipher-tz,
  dept-head-name: dept-head-name,
  head-name: head-name,
  norm-control-name: norm-control-name,
  author-name: author-short,
  year: year,
))
#include "parts/part1-spec/main.typ"
#metadata((kind: "diploma-doc-end", id: "tz"))

// 2. Пояснювальна записка
#start-part()
#metadata((kind: "diploma-doc-start", id: "pz", format: "A4", mark: cipher-pz, name: "Пояснювальна записка"))
#title-page(title-part2-software(
  title: title,
  cipher: cipher-pz,
  year: year,
))
#metadata("part2-content-start")<part2-content-start>
#include "parts/part2-software/main.typ"
#metadata("part2-content-end")<part2-content-end>
#metadata((kind: "diploma-doc-end", id: "pz"))

// 3. Текст програми
#start-part()
#metadata((kind: "diploma-doc-start", id: "tp", format: "A4", mark: cipher-tp, name: "Текст програми"))
#title-page(title-with-cipher(
  title: title,
  subtitle: "Текст програми",
  cipher: cipher-tp,
  dept-head-name: dept-head-name,
  head-name: head-name,
  norm-control-name: norm-control-name,
  author-name: author-short,
  year: year,
))
#include "parts/part3-program/main.typ"
#metadata((kind: "diploma-doc-end", id: "tp"))

// 4. Програма та методика тестування
#start-part()
#metadata((
  kind: "diploma-doc-start",
  id: "pmt",
  format: "A4",
  mark: cipher-pmt,
  name: "Програма та методика тестування",
))
#title-page(title-with-cipher(
  title: title,
  subtitle: "Програма та методика тестування",
  cipher: cipher-pmt,
  dept-head-name: dept-head-name,
  head-name: head-name,
  norm-control-name: norm-control-name,
  author-name: author-short,
  year: year,
))
#include "parts/part4-testing/main.typ"
#metadata((kind: "diploma-doc-end", id: "pmt"))

// 5. Керівництво користувача
#start-part()
#metadata((kind: "diploma-doc-start", id: "kk", format: "A4", mark: cipher-kk, name: "Керівництво користувача"))
#title-page(title-with-cipher(
  title: title,
  subtitle: "Керівництво користувача",
  cipher: cipher-kk,
  dept-head-name: dept-head-name,
  head-name: head-name,
  norm-control-name: norm-control-name,
  author-name: author-short,
  year: year,
))
#include "parts/part5-user-manual/main.typ"
#metadata((kind: "diploma-doc-end", id: "kk"))

// 6. Графічний матеріал
#start-part()
#metadata((
  kind: "diploma-doc-start",
  id: "graphic",
  format: "A3",
  mark: cipher-graphic,
  name: "Графічний матеріал",
))
#include "parts/part6-graphic/main.typ"
#metadata((kind: "diploma-doc-end", id: "graphic"))

// Додаток: звіт перевірки на плагіат
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
