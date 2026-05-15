import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconSymbol } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';
import { formatDuration } from '@/src/utils/format';

const PRESET_MINUTES: readonly number[] = [5, 10, 15, 30, 45, 60];

export type SleepTimerSheetProps = {
  visible: boolean;
  remainingSec: number | null;
  onPick: (minutes: number) => void;
  onCancel: () => void;
  onClose: () => void;
};

export function SleepTimerSheet({
  visible,
  remainingSec,
  onPick,
  onCancel,
  onClose
}: SleepTimerSheetProps) {
  const { colors, radius, spacing, fontSize, fontWeight } = useTheme();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        accessibilityRole="button"
        accessibilityLabel="Dismiss sleep timer"
        onPress={onClose}
      />
      <SafeAreaView edges={['bottom']} style={styles.sheetAnchor}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.bg,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              padding: spacing.lg,
              gap: spacing.md
            }
          ]}
        >
          <View style={styles.headerRow}>
            <Text
              style={{
                color: colors.text,
                fontSize: fontSize.title,
                fontWeight: fontWeight.semibold,
                flex: 1
              }}
            >
              Sleep timer
            </Text>
            {remainingSec != null ? (
              <Text style={{ color: colors.accent, fontSize: fontSize.body }}>
                {formatDuration(remainingSec)} left
              </Text>
            ) : null}
          </View>

          <Text style={{ color: colors.textMuted, fontSize: fontSize.caption }}>
            Pauses playback after the selected duration.
          </Text>

          <View style={[styles.grid, { gap: spacing.sm }]}>
            {PRESET_MINUTES.map(minutes => (
              <Pressable
                key={minutes}
                onPress={() => onPick(minutes)}
                accessibilityRole="button"
                accessibilityLabel={`Sleep timer ${minutes} minutes`}
                style={({ pressed }) => [
                  styles.cell,
                  {
                    backgroundColor: colors.bgElevated,
                    borderRadius: radius.md,
                    paddingVertical: spacing.md,
                    opacity: pressed ? 0.7 : 1
                  }
                ]}
              >
                <Text
                  style={{
                    color: colors.text,
                    fontSize: fontSize.body,
                    fontWeight: fontWeight.semibold
                  }}
                >
                  {minutes} min
                </Text>
              </Pressable>
            ))}
          </View>

          {remainingSec != null ? (
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel sleep timer"
              style={({ pressed }) => [
                styles.cancelRow,
                {
                  paddingVertical: spacing.md,
                  borderRadius: radius.md,
                  backgroundColor: colors.bgElevated,
                  opacity: pressed ? 0.7 : 1,
                  gap: spacing.sm
                }
              ]}
            >
              <IconSymbol name="xmark" size={18} color={colors.danger} weight="medium" />
              <Text
                style={{
                  color: colors.danger,
                  fontSize: fontSize.body,
                  fontWeight: fontWeight.semibold
                }}
              >
                Turn off
              </Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheetAnchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0
  },
  sheet: {},
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap'
  },
  cell: {
    minWidth: '30%',
    flexGrow: 1,
    alignItems: 'center'
  },
  cancelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center'
  }
});
