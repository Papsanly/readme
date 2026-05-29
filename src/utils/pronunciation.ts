import type { PronunciationOverride } from '@/src/types/settings';
import { newId } from '@/src/utils/id';

/**
 * Apply pronunciation overrides to narration text immediately before TTS.
 *
 * The reader UI keeps showing the original block text; only the synthesized
 * text swaps configured terms for their phonetic spelling. Longer terms are
 * replaced first so phrase overrides win over shorter nested terms.
 */
export function mergePronunciations(
  global: readonly PronunciationOverride[] | undefined,
  book: readonly PronunciationOverride[] | undefined
): PronunciationOverride[] {
  const merged = new Map<string, PronunciationOverride>();
  for (const item of global ?? []) {
    const normalized = normalizePronunciation(item);
    if (normalized) merged.set(normalized.key, normalized.item);
  }
  for (const item of book ?? []) {
    const normalized = normalizePronunciation(item);
    if (normalized) merged.set(normalized.key, normalized.item);
  }
  return Array.from(merged.values());
}

export function upsertPronunciationOverride(
  list: readonly PronunciationOverride[] | undefined,
  term: string,
  pronunciation: string
): PronunciationOverride[] {
  const cleanTerm = term.trim();
  const cleanPronunciation = pronunciation.trim();
  if (!cleanTerm || !cleanPronunciation) return [...(list ?? [])];

  let updated = false;
  const next = (list ?? []).map(item => {
    if (item.term.trim().toLocaleLowerCase() !== cleanTerm.toLocaleLowerCase()) return item;
    updated = true;
    return { ...item, term: cleanTerm, pronunciation: cleanPronunciation };
  });
  if (updated) return next;
  return [...next, { id: newId('pron'), term: cleanTerm, pronunciation: cleanPronunciation }];
}

export function applyPronunciationsToText(
  text: string,
  pronunciations: readonly PronunciationOverride[] | undefined
): string {
  if (!text || !pronunciations || pronunciations.length === 0) return text;

  const entries = pronunciations
    .map(item => ({ term: item.term.trim(), pronunciation: item.pronunciation.trim() }))
    .filter(item => item.term.length > 0 && item.pronunciation.length > 0)
    .sort((a, b) => b.term.length - a.term.length);

  let out = text;
  for (const { term, pronunciation } of entries) {
    const pattern = new RegExp(escapeRegExp(term), 'gi');
    out = out.replace(pattern, (match, offset: number, source: string) => {
      if (!hasValidBoundary(source, offset, match.length)) return match;
      return pronunciation;
    });
  }
  return out;
}

export function pronunciationCacheKey(
  pronunciations: readonly PronunciationOverride[] | undefined
): string {
  if (!pronunciations || pronunciations.length === 0) return '';
  return pronunciations
    .map(item => `${item.term.trim().toLocaleLowerCase()}=>${item.pronunciation.trim()}`)
    .filter(Boolean)
    .sort()
    .join('\n');
}

function normalizePronunciation(
  item: PronunciationOverride
): { key: string; item: PronunciationOverride } | undefined {
  const term = item.term.trim();
  const pronunciation = item.pronunciation.trim();
  if (!term || !pronunciation) return undefined;
  return {
    key: term.toLocaleLowerCase(),
    item: { ...item, term, pronunciation }
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasValidBoundary(source: string, offset: number, length: number): boolean {
  const before = offset > 0 ? source[offset - 1] : '';
  const after = offset + length < source.length ? source[offset + length] : '';
  return !isWordChar(before) && !isWordChar(after);
}

function isWordChar(ch: string): boolean {
  if (!ch) return false;
  return /[A-Za-z0-9_\u0400-\u04FF]/.test(ch);
}
