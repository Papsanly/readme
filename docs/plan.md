# plan

deadline: bachelor defense by **30.06.2026**. ~9 weeks total.

# milestones

- **mvp done**: 17.05.2026
- **product done**: 07.06.2026
- **thesis done**: 21.06.2026
- **antiplagiarism + print + binding + review**: 22-28.06.2026
- **defense**: by 30.06.2026

# mvp (3 weeks, until 17.05)

mvp uses teacher vlm directly via api. distillation comes after.

## week 1 (until 03.05): foundation

- pick mobile stack (react native / flutter / native?)
- app skeleton: navigation, library, upload, player stubs
- pick teacher vlm (gpt-4o / claude sonnet / gemini)
- design system prompt (block skipping modes, dictionary, tts tags)
- pdf -> page images -> teacher vlm -> tts ready text

## week 2 (until 10.05): tts + player

- elevenlabs integration (streaming per block)
- player: reflowed view, background playback
- voice search, speed multiplier
- library: list + progress storage, on-device cache

## week 3 (until 17.05): settings + polish

- block skipping settings (3 modes)
- pronunciation dictionary ui
- upload view (file system + url)
- end-to-end test on 5-10 real pdfs
- **mvp done**

# post-mvp (3 weeks, 18.05 - 07.06)

distillation as academic core + cram as many 1.x features as possible.
distillation runs in parallel (training is mostly waiting).

## week 4 (until 24.05): distillation kickoff + formats

- collect ~50-100 pdfs (mix: textbooks, fiction, scanned, articles)
- generate dataset: pdf pages -> teacher output (~5-10k pairs) and potentially if there is time some manual cleanup
- pick student (qwen2.5-vl-3b / phi-3-vision / smolvlm)
- training pipeline (lora, hf trainer, colab/runpod gpu)
- 1.x: more formats (doc, docx, html, epub via converters to pdf/images)

## week 5 (until 31.05): student training + ui features

- first training run + iterate
- metrics: accuracy vs teacher, bleu/rouge, latency, size
- 1.x: original view (ocr via datalab.to + alignment with vlm output)
- 1.x: outline support
- 1.x: skip to main content button
- 1.x: sleep timer

## week 6 (until 07.06): integration + offline + demo

- swap teacher api -> trained student in pipeline
- 1.x: offline mode (preload full audio per book)
- 1.x: export/import (compressed library + settings + cache)
- final metrics run for thesis
- bug fixing on real pdfs

# thesis (2 weeks, 08.06 - 21.06)

write in parallel with product if possible, but main block here.

## week 7 (until 14.06)

- intro, problem statement, related work
- chapter 1: theoretical - ocr/vlm/tts/distillation overview

## week 8 (until 21.06)

- chapter 2: methodology - pipeline, dataset, distillation setup
- chapter 3: implementation - app architecture, integrations
- chapter 4: results - metrics tables, comparison teacher vs student
- conclusions, abstract, references

# final stretch (22.06 - 30.06)

- 22-23.06: antiplagiarism check (unicheck), fixes
- 24-25.06: norm-control, supervisor signature
- 26.06: print, binding
- 27-28.06: external reviewer
- 29.06: presentation slides + rehearsal
- **30.06: defense**

# risks

- **scope too big**: 1.x has 7+ features in 3 weeks - expect to drop some. priority: distillation > original view > offline > formats > the rest
- **distillation fails / bad metrics**: fallback - keep teacher api in production, present distillation as research with honest results or leave as a choice for a user
- **mobile stack learning curve**: pick what you know; if unsure - react native expo (fastest)
- **dataset generation cost**: cap teacher api spend, batch requests

# rules

- 4-6 hours daily minimum
- weekly check on friday: are you on track? if not - cut 1.x scope, never mvp or thesis
- keep dev notes daily (1-2 sentences) - saves days when writing thesis
- commit often, push to remote
