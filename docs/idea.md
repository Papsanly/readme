the idea is to create a mobile app that naturally reads books in any possible format with an AI voice.

steps:
1. user uploads book to the app
2. we transform the book to an image sequence
3. using OCR models we extract semantic meaning from the images to:
  - create appropriate <semantic_tags> around some text
  - filter out what shouldn't be read
  - transform numbers, reductions and other type of text constructs that are pronounce differently than it is written
  - create a system prompt for the TTS model (possibly adjustable by the user)
4. feed the results of the previous step to a TTS engine
5. play the created audio
6. have some views where user can see what is being read, what is filtered out and so on
