// Project metadata shared across all parts of the paper.
// Single source of truth — change values here and they propagate everywhere.

// Project
#let project-name = "ReadMe"
#let title = "Мобільний застосунок для генерації аудіокниг на основі ШІ"
#let year = "2026"

// Cipher — decomposed by parts of the diploma.
// Format: КПІ.<group_code>-<journal_no>.<dev_type>.<doc_serial>.<doc_type>
//   doc_serial: 01 = ТЗ, 02 = ПЗ, 03 = Текст програми, ...
//   doc_type:   91 = ТЗ, 81 = ПЗ, 12 = Текст програми, ...
#let cipher-base = "КПІ.ІП-1119.045440"
#let cipher-tz = cipher-base + ".01.91"
#let cipher-pz = cipher-base + ".02.81"
#let cipher-tp = cipher-base + ".03.12"

// Source code repository
#let repo-url = "https://github.com/papsanly/readme"

// Author
#let author-full = "Лисенко Андрій Юрійович"
#let author-short = "Андрій ЛИСЕНКО"
#let group = "ІП-24"
#let course = "4"
#let speciality = "121 «Інженерія програмного забезпечення»"

// People
#let dept-head-name = "Едуард ЖАРІКОВ"
#let head-name = "Микола ХРАМЧЕНКО"
#let norm-control-name = "Тетяна ШУЛЬКЕВИЧ"

// University
#let university-full = "Національний технічний університет України"
#let institute = "Київський політехнічний інститут імені Ігоря Сікорського"
#let faculty = "Факультет інформатики та обчислювальної техніки"
#let department = "Кафедра інформатики та програмної інженерії"

// Document counters — stepped at each occurrence so totals compute themselves.
// Reference via *-count (digit) or *-last-ref (ref to last labelled item).
#let uc-counter = counter("uc")
#let fr-counter = counter("fr")
#let test-counter = counter("test")

#let _pad2(n) = if n < 10 { "0" + str(n) } else { str(n) }

#let uc-count = context str(uc-counter.final().first())
#let fr-count = context str(fr-counter.final().first())
#let test-count = context str(test-counter.final().first())
#let uc-last-ref = context ref(label("tbl-uc-" + _pad2(uc-counter.final().first())), supplement: none)

// Practice
#let practice-base = [ТОВ Вестерн Сим'юлейшнз "ВіФлай"]
#let practice-base-head-position = "директор"
#let practice-base-head-name = "Карсон ВЕСТЕРН"
#let practice-supervisor-position = "асистент"
#let practice-supervisor-name = "Шулькевич Тетяна Вікторівна"
#let practice-from = (day: "20", month: "квітня", year: "26")
#let practice-to = (day: "17", month: "травня", year: "26")
