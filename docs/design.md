# idea

the main idea of the app is to provide users with a mobile app to create a profesional quality
audiobooks from any format with as little effort as possible. the app should support all major text
or image based formats (pdf, word, html, txt, png, jpg...). the app uses the latest OCR and LLM
technologies to reach this goal.

**why this exists:** existing apps read everything, even those things that definitely shouldn't,
like outline, footnotes or even page numbers. some apps don't do any tts normalization before trying
to synthesize. this is especially bad for pdf-scan documents. this makes the output unlistenable.
this project aims to fix this, using a combination of technics like reading classifier and tts
normalization. also, we just tested some pdfs, easy to read for human readers, but for some
reason many such apps unable to resonably parse or read the content. even while claiming that
they can.

# mvp

## the pipeline

### ocr engine

using existing good solution: [datalab.to](https://datalab.to). its main purpose is to convert
images to a sequence of blocks (correctly arranged for correct narration order) each containing the
following information:

- text content
- block type
- polygon or bbox
- description (optional, useful for images, diagrams, tables)

this step is applied only for image based formats.

for actual images -> tts ready text we use vlm approach described below. ocr engine is only needed
for the **original view** which is moved to 1.x features

### vlm: better ocr + tts normalization

this should be our academic core. the plan is to use a vlm to do two most important tasks: ocr and
tts normalization. the vlm model gets the original image and outputs tts normalized, semanticaly
correct text with natural reading flow without unnessesary service elements. **why this approach**:
tests show that current state of the art vlm models outperform ocr solutions on the task of creating
a tts readable text. the reason might be that vlms (or llms) have better context understanding
through a better world model, thus producing more logical reading flow output. simply speaking they
understand what they see and adapt the output rather than just spitting out exactly what they see
like the ocr models.

the resulting model should still be run on the server for now. on-device model is for the 1.x
feature set

the reason that this should be our academic core is that we to do smaller model fine-tuning via
large teacher model distilation. this will drastically reduce costs and latency for processing
documents before sending them to the tts engine.

**important considerations:**

- we should use
  [best practices from elevenlabs](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices)
  for the system prompt

- have a description and some context around the book and use it in the system prompt as well so the
  model better understands the input thus producing more semantically correct output

- some words have specific pronounciation which can be incorrectly deduced by the tts engine
  (omographs, abbreviations, book specific words). we should have a dictionary of those words and
  their correct pronounciation and use it in the system prompt so that the model will normalize
  those. possibly we can have a feature for that in the ui)

- possibly already described in best practices for elevenlabs, but it is important for the model to
  also spit out semantically correct system tags for the tts engine so that it better uderstands
  emotions of the text, this is especially important for fiction books. this should dramatically
  descrease the influence of the robotic nature of many tts engine. the output should sound more
  human

### tts generation

choice: [ElevenLabs](https://elevenlabs.io) reason: best quality and good api

we should do tts streaming, meaning audio is generated on demand per block, rather than full
background processing. benefits are obvious for users and for us. also solves large files problem

## the app

### upload

with a prominantly visible button move to a upload view. the user will have to options: to load the
file from the device file system or from a url. after uploading user jumps directly to the player
view

### library

stores and shows a list of uploaded books and their metadata and cached audio on device. **why not
on a server:** books, especially pdfs, can be very large, benefits to the user are very rare -
people mostly don't need device sync for mobile apps - because they typicaly have only one phone.
also we can have a export/import feature for users who really need to switch devices (see 1.x
features).

this page also should show where the user left the last session, so it should store user progress on
a book.

### player

the player shows a **reflowed view**: a clean, reader-friendly representation of the parsed content.
the original PDF is not shown. instead the user sees extracted text along with images, diagrams and
their captions. optimized for comfortable reading.

**important:** ability to listen in the background (outside an app, with screen off)

### settings page

#### voice settings

- searching premade voices from elevenlabs
- speed multiplier

### block skipping settings

have a setting to let the user decide between three modes of text block skipping:

- skip everything except the main content of the book
- skip only service elements
- don't skip anything

this will control the system prompt for the VLM

# 1.x features

## original view

for image based formats only: the original pdf is displayed as-is, with parsed blocks highlighted.
the currently read block is emphasized, and different block types (as well as whether a block is
being read or skipped) can be distinguished by color and highlight intensity.

**open question:** how to align the ocr and vlm output, so to synchronously highlight the block that
is currently being read

## more formats support

support all the following formats:

- **documents**: PDF, DOC, DOCX, ODT
- **presentations**: PPT, PPTX, ODP
- **web & books**: HTML, EPUB
- **images**: PNG, JPEG, JPG, WEBP, GIF, TIFF

## export/import feature

add ability to export data of the book library (compressed), user settings and cache. add ability to
import that data.

## outline support

create a view where user can see an outline of the book to directly move to it

## inteligently skip to main content

add a button to let the user directly skip to the main content of the book. this significantly
reduces number of action user will need to do to get the main value of the app. only reasonable if
the user didn't already select this option in the settings page

## sleep timer

important for people who listen books while falling asleep. should just stop the playback after
certain amount of time

## offline mode

add ability to preload whole audio book generation on device to listen while not having connection
for streaming. potentially connects to export/import feature with downloading the resulting audio
file

# 2.x features

## support for currently spoken word

the original and reflowed view will have a highlight for currently read _block_ for the mvp
implementation. what this feature aims to deliver is another level of highlight for the currently
spoken word

## more voice settings

- creating a voice from a prompt
- creating a voice based on the book content - basically that's like having an initial prompt about
  how should the book be read
- voice cloning

## scaning paper books

add easy way for users to scan paper books directly in app.

## dictating or pasting/writing regular text

needs speech-to-text model for dictation feature. for writing regular text feature - a simple text
editor.

## tts generation with multiple voices

useful for books with multiple characters. involves creating a metadata attached to a book mapping
the characters from a book to a voice id. this table should be created on demand, when new
characters appear in the book. probably we should use an llm for that feature - to extract
characters and map text input to them.

## on-device vlm and tts model

make the model good enough and small enough for it to be able to be ran on device without eating to
much system resources
