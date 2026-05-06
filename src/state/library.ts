import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type {
  Book,
  BookProgress,
  BookSettingsOverride,
  BookStatus,
  ProcessingProgress
} from '@/src/types/book';

type LibraryState = {
  books: Record<string, Book>;
  addBook: (book: Book) => void;
  updateBook: (id: string, patch: Partial<Book>) => void;
  removeBook: (id: string) => void;
  setProcessing: (id: string, progress: ProcessingProgress) => void;
  setStatus: (id: string, status: BookStatus, error?: string) => void;
  setProgress: (id: string, progress: BookProgress) => void;
  /**
   * Patch the book's per-book settings override. Each field passed as
   * `undefined` is removed (i.e. reset to default). Pass `null` for the
   * whole patch to clear the override entirely.
   */
  setSettingsOverride: (id: string, patch: BookSettingsOverride | null) => void;
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
        }),

      setSettingsOverride: (id, patch) =>
        set(state => {
          const existing = state.books[id];
          if (!existing) return state;
          if (patch === null) {
            // Remove the override entirely.
            const { settingsOverride: _drop, ...rest } = existing;
            return { books: { ...state.books, [id]: rest } };
          }
          // Merge keys; explicit `undefined` values clear that single key.
          const merged = { ...(existing.settingsOverride ?? {}) };
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined) {
              delete (merged as Record<string, unknown>)[k];
            } else {
              (merged as Record<string, unknown>)[k] = v;
            }
          }
          const next: Book = { ...existing };
          if (Object.keys(merged).length === 0) {
            delete next.settingsOverride;
          } else {
            next.settingsOverride = merged;
          }
          return { books: { ...state.books, [id]: next } };
        })
    }),
    {
      name: 'readme:library',
      storage: createJSONStorage(() => AsyncStorage)
    }
  )
);
