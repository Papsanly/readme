import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle
} from 'react-native';

import { IconSymbol, ProgressBar, type IconName } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';
import { formatDuration } from '@/src/utils/format';

const PLAY_BUTTON_SIZE = 56;
const STEP_BUTTON_SIZE = 44;
const PILL_HEIGHT = 30;

export type PlayerControlsProps = {
  isPlaying: boolean;
  isLoadingBlock: boolean;
  blockError?: string;
  /** Intra-block playback position in seconds. */
  positionSec: number;
  /** Intra-block duration in seconds. May be 0 while loading. */
  durationSec: number;
  /** Current speed multiplier (e.g. 1.0). */
  speed: number;
  /** Voice display name, or undefined when no voice has been picked yet. */
  voiceName?: string;
  /** Whether the prev / next block buttons should be enabled. */
  canPrev: boolean;
  canNext: boolean;

  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeekBy: (deltaSec: number) => void;
  onCycleSpeed: () => void;
  onOpenVoice: () => void;
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
  speed,
  voiceName,
  canPrev,
  canNext,
  onTogglePlay,
  onPrev,
  onNext,
  onSeekBy,
  onCycleSpeed,
  onOpenVoice,
  onRetryCurrentBlock,
  style
}: PlayerControlsProps) {
  const { colors, radius, spacing, fontSize, fontWeight } = useTheme();

  const ratio = durationSec > 0 ? positionSec / durationSec : 0;
  const playIcon: IconName = isPlaying ? 'pause.fill' : 'play.fill';
  const speedLabel = `${speed.toFixed(speed === Math.round(speed) ? 1 : 2)}×`;
  const voiceLabel = voiceName ?? 'Choose voice';

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
          paddingBottom: spacing.lg,
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
        <ProgressBar progress={ratio} height={3} />
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
          disabled={isLoadingBlock && !isPlaying}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
          accessibilityState={{ disabled: isLoadingBlock && !isPlaying, busy: isLoadingBlock }}
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
          <IconSymbol name={playIcon} size={26} color={colors.accentText} weight="semibold" />
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

      <View style={[styles.row, { gap: spacing.sm, justifyContent: 'center' }]}>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            onCycleSpeed();
          }}
          accessibilityRole="button"
          accessibilityLabel={`Playback speed ${speedLabel}`}
          style={({ pressed }) => [
            styles.pill,
            {
              height: PILL_HEIGHT,
              backgroundColor: colors.bg,
              borderColor: colors.border,
              borderRadius: PILL_HEIGHT / 2,
              paddingHorizontal: spacing.md,
              opacity: pressed ? 0.6 : 1
            }
          ]}
        >
          <Text
            style={{
              color: colors.text,
              fontSize: fontSize.caption,
              fontWeight: fontWeight.semibold
            }}
          >
            {speedLabel}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            onOpenVoice();
          }}
          accessibilityRole="button"
          accessibilityLabel={voiceName ? `Voice: ${voiceName}` : 'Choose voice'}
          style={({ pressed }) => [
            styles.pill,
            {
              height: PILL_HEIGHT,
              backgroundColor: colors.bg,
              borderColor: colors.border,
              borderRadius: PILL_HEIGHT / 2,
              paddingHorizontal: spacing.md,
              gap: spacing.xs,
              opacity: pressed ? 0.6 : 1
            }
          ]}
        >
          <IconSymbol name="speaker.wave.2.fill" size={12} color={colors.text} weight="medium" />
          <Text
            style={{
              color: colors.text,
              fontSize: fontSize.caption,
              fontWeight: fontWeight.semibold,
              maxWidth: 160
            }}
            numberOfLines={1}
          >
            {voiceLabel}
          </Text>
        </Pressable>
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
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center'
  }
});
