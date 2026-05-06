import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconSymbol, Slider, type IconName } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';
import { formatDuration } from '@/src/utils/format';

const PLAY_BUTTON_SIZE = 56;
const STEP_BUTTON_SIZE = 44;

export type PlayerControlsProps = {
  isPlaying: boolean;
  isLoadingBlock: boolean;
  blockError?: string;
  /** Page-level (or whatever aggregated unit the host chooses) playback position. */
  positionSec: number;
  /** Page-level duration. May be 0 while the first block is loading. */
  durationSec: number;
  /** 1-based current page number; `0` when there are no pages. */
  currentPage?: number;
  /** Total page count in the book. */
  totalPages?: number;
  /** Whether the prev / next block buttons should be enabled. */
  canPrev: boolean;
  canNext: boolean;

  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeekBy: (deltaSec: number) => void;
  /** Absolute seek to `positionSec` within the current page. Optional. */
  onSeekTo?: (positionSec: number) => void;
  onRetryCurrentBlock: () => void;

  style?: StyleProp<ViewStyle>;
};

function HapticPressable({
  onPress,
  disabled,
  size,
  ariaLabel,
  children,
  style
}: {
  onPress: () => void;
  disabled?: boolean;
  size: number;
  ariaLabel: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const handle = (_: GestureResponderEvent) => {
    if (disabled) return;
    Haptics.selectionAsync().catch(() => {});
    onPress();
  };
  return (
    <Pressable
      onPress={handle}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={ariaLabel}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.35 : pressed ? 0.6 : 1
        },
        style
      ]}
    >
      {children}
    </Pressable>
  );
}

export function PlayerControls({
  isPlaying,
  isLoadingBlock,
  blockError,
  positionSec,
  durationSec,
  currentPage,
  totalPages,
  canPrev,
  canNext,
  onTogglePlay,
  onPrev,
  onNext,
  onSeekBy,
  onSeekTo,
  onRetryCurrentBlock,
  style
}: PlayerControlsProps) {
  const { colors, radius, spacing, fontSize, fontWeight } = useTheme();
  const insets = useSafeAreaInsets();

  const playIcon: IconName = isPlaying ? 'pause.fill' : 'play.fill';

  const handleTogglePlay = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onTogglePlay();
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.bgElevated,
          borderTopColor: colors.border,
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.md,
          // Bottom padding: our usual `spacing.lg` *plus* the system inset
          // (Android navigation-bar height / iOS home-indicator height) so
          // the controls don't visually touch system chrome.
          paddingBottom: spacing.lg + insets.bottom,
          gap: spacing.md
        },
        style
      ]}
    >
      {blockError ? (
        <View
          style={[
            styles.errorBanner,
            {
              backgroundColor: colors.danger,
              borderRadius: radius.md,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md
            }
          ]}
        >
          <Text
            style={{
              color: colors.accentText,
              fontSize: fontSize.body,
              fontWeight: fontWeight.medium,
              flex: 1
            }}
            numberOfLines={2}
          >
            {blockError}
          </Text>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              onRetryCurrentBlock();
            }}
            accessibilityRole="button"
            accessibilityLabel="Retry current block"
            hitSlop={8}
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, marginLeft: spacing.md }]}
          >
            <Text
              style={{
                color: colors.accentText,
                fontSize: fontSize.body,
                fontWeight: fontWeight.semibold
              }}
            >
              Retry
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View>
        {currentPage && totalPages ? (
          <View
            style={[
              styles.row,
              { justifyContent: 'center', gap: spacing.xs, marginBottom: spacing.xs }
            ]}
          >
            {isLoadingBlock ? <ActivityIndicator size="small" color={colors.accent} /> : null}
            <Text
              style={{
                color: colors.textMuted,
                fontSize: fontSize.caption,
                fontWeight: fontWeight.medium
              }}
            >
              {isLoadingBlock ? 'Loading audio…' : `Page ${currentPage} of ${totalPages}`}
            </Text>
          </View>
        ) : null}
        <Slider
          value={positionSec}
          min={0}
          max={Math.max(durationSec, 0.0001)}
          step={0.1}
          onChangeCommit={onSeekTo}
          height={4}
          thumbSize={18}
        />
        <View style={[styles.row, { marginTop: spacing.xs, justifyContent: 'space-between' }]}>
          <Text style={{ color: colors.textMuted, fontSize: fontSize.caption }}>
            {formatDuration(positionSec)}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: fontSize.caption }}>
            {durationSec > 0 ? formatDuration(durationSec) : '--:--'}
          </Text>
        </View>
      </View>

      <View style={[styles.transport, { gap: spacing.sm }]}>
        <HapticPressable
          onPress={onPrev}
          disabled={!canPrev}
          size={STEP_BUTTON_SIZE}
          ariaLabel="Previous block"
        >
          <IconSymbol name="chevron.left" size={22} color={colors.text} weight="medium" />
        </HapticPressable>
        <HapticPressable
          onPress={() => onSeekBy(-15)}
          size={STEP_BUTTON_SIZE}
          ariaLabel="Skip back 15 seconds"
        >
          <IconSymbol name="gobackward.15" size={26} color={colors.text} weight="medium" />
        </HapticPressable>
        <Pressable
          onPress={handleTogglePlay}
          disabled={isLoadingBlock}
          accessibilityRole="button"
          accessibilityLabel={isLoadingBlock ? 'Loading audio' : isPlaying ? 'Pause' : 'Play'}
          accessibilityState={{ disabled: isLoadingBlock, busy: isLoadingBlock }}
          style={({ pressed }) => [
            styles.playButton,
            {
              width: PLAY_BUTTON_SIZE,
              height: PLAY_BUTTON_SIZE,
              borderRadius: PLAY_BUTTON_SIZE / 2,
              backgroundColor: colors.accent,
              opacity: pressed ? 0.85 : 1
            }
          ]}
        >
          {isLoadingBlock ? (
            <ActivityIndicator color={colors.accentText} size="small" />
          ) : (
            <IconSymbol name={playIcon} size={26} color={colors.accentText} weight="semibold" />
          )}
        </Pressable>
        <HapticPressable
          onPress={() => onSeekBy(15)}
          size={STEP_BUTTON_SIZE}
          ariaLabel="Skip forward 15 seconds"
        >
          <IconSymbol name="goforward.15" size={26} color={colors.text} weight="medium" />
        </HapticPressable>
        <HapticPressable
          onPress={onNext}
          disabled={!canNext}
          size={STEP_BUTTON_SIZE}
          ariaLabel="Next block"
        >
          <IconSymbol name="chevron.right" size={22} color={colors.text} weight="medium" />
        </HapticPressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  transport: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  playButton: { alignItems: 'center', justifyContent: 'center' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center'
  }
});
