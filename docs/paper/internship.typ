#import "template/main.typ": diploma
#import "template/title-internship.typ": title-page as title-internship
#import "template/title-with-cipher.typ": title-with-cipher
#import "template/title-part2-software.typ": title-part2-software
#import "data.typ": *

#show: diploma

// 1. Internship title page
#title-internship(
  course: course,
  group: group,
  author: author-full,
  term-from-day: practice-from.day,
  term-from-month: practice-from.month,
  term-from-year: practice-from.year,
  term-to-day: practice-to.day,
  term-to-month: practice-to.month,
  term-to-year: practice-to.year,
  base: practice-base,
  base-head-position: practice-base-head-position,
  base-head-name: practice-base-head-name,
  dept-head-position: practice-supervisor-position,
  dept-head-name: practice-supervisor-name,
  year: practice-to.year,
)

#pagebreak(weak: true)

// 2. Part 1 — Технічне завдання
#title-with-cipher(
  title: title,
  subtitle: "Технічне завдання",
  cipher: cipher-tz,
  dept-head-name: dept-head-name,
  head-name: head-name,
  norm-control-name: norm-control-name,
  author-name: author-short,
  year: year,
)

#include "parts/part1-spec/main.typ"

#pagebreak(weak: true)

// 3. Part 2 — Пояснювальна записка
#title-part2-software(
  title: title,
  cipher: cipher-pz,
  year: year,
)

#include "parts/part2-software/main.typ"

#pagebreak(weak: true)

// 4. Part 3 — Текст програми
#title-with-cipher(
  title: title,
  subtitle: "Текст програми",
  cipher: cipher-tp,
  dept-head-name: dept-head-name,
  head-name: head-name,
  norm-control-name: norm-control-name,
  author-name: author-short,
  year: year,
)

#include "parts/part3-program/main.typ"
