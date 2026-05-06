import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/src/hooks/useTheme';
import type { Block } from '@/src/types/book';

export type CurrentPageViewProps = {
  blocks: readonly Block[];
  currentIndex: number;
  /** Bottom padding so the bottom of the page text isn't hidden behind controls. */
  bottomInset: number;
  /** Optional error text — when present, the view shows a retry hint at the bottom. */
  errorMessage?: string;
  /** Tap handler for the retry hint. */
  onRetry?: () => void;
  /** Called when the user taps a word; jumps audio playback to that word. */
  onWordTap: (blockIndex: number, offsetSec: number) => void;
  /**
   * Convert a (block, char offset within its text) pair to an audio
   * offset in seconds. Backed by per-character TTS timestamps when the
   * provider supplied them (ElevenLabs); a proportional estimate
   * otherwise (local XTTS server).
   */
  charOffsetToAudioSec: (block: Block, charOffset: number) => number;
};

type WordToken = {
  /** Word text plus any trailing whitespace (kept together so we render one
   *  inline `<Text>` per word, not two — halves the React node count). */
  text: string;
  /** Global block index this token belongs to. */
  blockIndex: number;
  /** 0-based char offset of the *word part* within its block's text. */
  charOffsetInBlock: number;
};

/**
 * Match every "word + trailing whitespace" run in `text`. `(\S+)` captures
 * the word for the seek offset; `\s*` after it sweeps up the spaces so
 * they don't become their own tokens.
 */
const WORD_TOKEN_RE = /(\S+)(\s*)/g;

function tokenizeBlock(text: string, blockIndex: number, out: WordToken[]): void {
  WORD_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_TOKEN_RE.exec(text)) !== null) {
    out.push({
      text: m[0],
      blockIndex,
      charOffsetInBlock: m.index
    });
  }
}

/**
 * Displays exactly one page at a time — the page that the audio engine is
 * currently reading. As the engine crosses a page boundary, the body
 * swaps to the next page automatically. There is no scrollable list of
 * pages; navigation between pages is via the player's prev/next controls.
 *
 * Each non-whitespace token is its own pressable `<Text>` — tapping a word
 * jumps audio playback to that word's estimated position in the block.
 */
export function CurrentPageView({
  blocks,
  currentIndex,
  bottomInset,
  errorMessage,
  onRetry,
  onWordTap,
  charOffsetToAudioSec
}: CurrentPageViewProps) {
  const { colors, spacing, fontSize, fontWeight, radius } = useTheme();

  // Page-identification — cheap, derived on every render.
  const safeIndex = blocks.length > 0 ? Math.min(Math.max(currentIndex, 0), blocks.length - 1) : -1;
  const pageNumber = safeIndex >= 0 ? (blocks[safeIndex]?.page ?? 1) : 0;
  const totalPages = useMemo(() => {
    if (blocks.length === 0) return 0;
    const all = new Set<number>();
    for (const b of blocks) all.add(b.page ?? 1);
    return all.size;
  }, [blocks]);

  // Tokens recompute only when the *page* changes (or blocks list mutates),
  // not on every block-index change within the same page. This was the
  // bulk of the per-page-switch work — building 500–1000 React elements.
  const tokens = useMemo<WordToken[]>(() => {
    if (pageNumber === 0) return [];
    const out: WordToken[] = [];
    let firstOnPage = true;
    for (let i = 0; i < blocks.length; i += 1) {
      const b = blocks[i];
      if ((b.page ?? 1) !== pageNumber) continue;
      // Paragraph break between blocks. Attached as the last token's own
      // trailing whitespace would mix into the seek logic, so we add it
      // as a synthetic non-pressable token instead.
      if (!firstOnPage) {
        out.push({ text: '\n\n', blockIndex: i, charOffsetInBlock: -1 });
      }
      firstOnPage = false;
      tokenizeBlock(b.text, i, out);
    }
    return out;
  }, [blocks, pageNumber]);

  // Snap the ScrollView back to the top whenever the audio engine moves
  // to a new page. We scroll via ref instead of forcing a full unmount
  // through `key={...}` — remounting a ScrollView with hundreds of inline
  // `<Text>` tokens was causing a multi-second freeze on long pages.
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [pageNumber]);

  // Pre-bake one stable handler per token so React reconciliation can skip
  // unchanged Text nodes during re-renders (a fresh inline closure on
  // every render forces every span's click listener to be re-bound on
  // Android, eating into page-switch frame budget).
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const onWordTapRef = useRef(onWordTap);
  onWordTapRef.current = onWordTap;
  const charOffsetToAudioSecRef = useRef(charOffsetToAudioSec);
  charOffsetToAudioSecRef.current = charOffsetToAudioSec;
  const handlersRef = useRef<(() => void)[]>([]);
  handlersRef.current = useMemo(
    () =>
      tokens.map(t => () => {
        if (t.charOffsetInBlock < 0) return; // synthetic paragraph break
        Haptics.selectionAsync().catch(() => {});
        const block = blocksRef.current[t.blockIndex];
        if (!block) return;
        const offsetSec = charOffsetToAudioSecRef.current(block, t.charOffsetInBlock);
        onWordTapRef.current(t.blockIndex, offsetSec);
      }),
    [tokens]
  );

  if (totalPages === 0) return null;

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={{
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.lg,
        paddingBottom: bottomInset + spacing.lg,
        gap: spacing.md
      }}
      showsVerticalScrollIndicator={false}
    >
      <View
        style={[
          styles.pageHeader,
          {
            borderBottomColor: colors.border,
            paddingBottom: spacing.sm
          }
        ]}
      >
        <Text
          style={{
            color: colors.textMuted,
            fontSize: fontSize.caption,
            fontWeight: fontWeight.medium,
            letterSpacing: 0.5,
            textTransform: 'uppercase'
          }}
        >
          Page {pageNumber} of {totalPages}
        </Text>
      </View>

      <Text
        style={{
          color: colors.text,
          fontSize: fontSize.bodyLg,
          fontWeight: fontWeight.regular,
          lineHeight: fontSize.bodyLg * 1.5
        }}
      >
        {tokens.map((t, i) =>
          t.charOffsetInBlock < 0 ? (
            <Text key={i}>{t.text}</Text>
          ) : (
            <Text key={i} onPress={handlersRef.current[i]} suppressHighlighting={false}>
              {t.text}
            </Text>
          )
        )}
      </Text>

      {errorMessage ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry current page"
          style={({ pressed }) => [
            styles.errorBox,
            {
              backgroundColor: colors.bgElevated,
              borderColor: colors.danger,
              borderRadius: radius.md,
              padding: spacing.md,
              opacity: pressed ? 0.8 : 1
            }
          ]}
        >
          <Text
            style={{
              color: colors.danger,
              fontSize: fontSize.caption,
              fontWeight: fontWeight.medium
            }}
            numberOfLines={3}
          >
            {errorMessage}
          </Text>
          <Text
            style={{
              color: colors.danger,
              fontSize: fontSize.caption,
              fontWeight: fontWeight.semibold,
              marginTop: 4
            }}
          >
            Tap to retry
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pageHeader: { borderBottomWidth: StyleSheet.hairlineWidth },
  errorBox: { borderWidth: 1 }
});
