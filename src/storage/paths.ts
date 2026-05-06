import { Paths } from 'expo-file-system';

function join(...parts: string[]): string {
  return Paths.join(...parts);
}

export const paths = {
  bookDir(bookId: string): string {
    return join(Paths.document.uri, 'books', bookId);
  },
  bookSource(bookId: string, ext: string): string {
    const cleanExt = ext.startsWith('.') ? ext.slice(1) : ext;
    return join(paths.bookDir(bookId), `source.${cleanExt}`);
  },
  bookPagesDir(bookId: string): string {
    return join(paths.bookDir(bookId), 'pages');
  },
  bookPage(bookId: string, pageNumber: number): string {
    return join(paths.bookPagesDir(bookId), `${pageNumber}.png`);
  },
  bookAudioDir(bookId: string): string {
    return join(paths.bookDir(bookId), 'audio');
  },
  bookAudio(bookId: string, blockId: string): string {
    return join(paths.bookAudioDir(bookId), `${blockId}.mp3`);
  },
  /** Per-block alignment (TTS character timestamps), saved next to the audio. */
  bookAudioAlignment(bookId: string, blockId: string): string {
    return join(paths.bookAudioDir(bookId), `${blockId}.alignment.json`);
  },
  bookCover(bookId: string): string {
    return join(paths.bookDir(bookId), 'cover.png');
  }
};
