import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { Book, BookProgress, BookStatus, ProcessingProgress } from '@/src/types/book';

type LibraryState = {
  books: Record<string, Book>;
  addBook: (book: Book) => void;
  updateBook: (id: string, patch: Partial<Book>) => void;
  removeBook: (id: string) => void;
  setProcessing: (id: string, progress: ProcessingProgress) => void;
  setStatus: (id: string, status: BookStatus, error?: string) => void;
  setProgress: (id: string, progress: BookProgress) => void;
};

export const useLibraryStore = create<LibraryState>()(
  persist(
    set => ({
      books: {},

      addBook: book =>
        set(state => ({
          books: { ...state.books, [book.id]: book }
        })),

      updateBook: (id, patch) =>
        set(state => {
          const existing = state.books[id];
          if (!existing) return state;
          return {
            books: { ...state.books, [id]: { ...existing, ...patch } }
          };
        }),

      removeBook: id =>
        set(state => {
          if (!(id in state.books)) return state;
          const next = { ...state.books };
          delete next[id];
          return { books: next };
        }),

      setProcessing: (id, progress) =>
        set(state => {
          const existing = state.books[id];
          if (!existing) return state;
          return {
            books: {
              ...state.books,
              [id]: { ...existing, processingProgress: progress }
            }
          };
        }),

      setStatus: (id, status, error) =>
        set(state => {
          const existing = state.books[id];
          if (!existing) return state;
          return {
            books: {
              ...state.books,
              [id]: { ...existing, status, processingError: error }
            }
          };
        }),

      setProgress: (id, progress) =>
        set(state => {
          const existing = state.books[id];
          if (!existing) return state;
          return {
            books: {
              ...state.books,
              [id]: { ...existing, progress }
            }
          };
        })
    }),
    {
      name: 'readme:library',
      storage: createJSONStorage(() => AsyncStorage)
    }
  )
);
