import { Image } from 'expo-image';
import { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle
} from 'react-native';

import { Button, IconSymbol, ProgressBar } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';
import type { ProcessingProgress } from '@/src/types/book';

const COVER_WIDTH = 200;
const COVER_HEIGHT = 280;

export type ProcessingViewProps = {
  title: string;
  coverUri?: string;
  stage: ProcessingProgress['stage'];
  done: number;
  total: number;
  onCancel: () => void;
  style?: StyleProp<ViewStyle>;
};

const STAGE_LABELS: Record<ProcessingProgress['stage'], string> = {
  rendering: 'Rendering pages…',
  analyzing: 'Analyzing pages…',
  done: 'Finishing up…'
};

export function ProcessingView({
  title,
  coverUri,
  stage,
  done,
  total,
  onCancel,
  style
}: ProcessingViewProps) {
  const { colors, radius, spacing, fontSize, fontWeight } = useTheme();
  const [coverFailed, setCoverFailed] = useState(false);

  const showPlaceholder = !coverUri || coverFailed;
  const ratio = total > 0 ? done / total : 0;
  const stageLabel = STAGE_LABELS[stage];
  const subtitle = total > 0 ? `Page ${Math.min(done, total)} of ${total}` : 'Preparing…';

  return (
    <View style={[styles.container, { padding: spacing.lg, gap: spacing.lg }, style]}>
      <View
        style={[
          styles.cover,
          {
            width: COVER_WIDTH,
            height: COVER_HEIGHT,
            borderRadius: radius.lg,
            backgroundColor: colors.bgElevated
          }
        ]}
      >
        {showPlaceholder ? (
          <IconSymbol name="book" size={56} color={colors.textMuted} />
        ) : (
          <Image
            source={{ uri: coverUri }}
            style={styles.coverImage}
            contentFit="cover"
            transition={150}
            cachePolicy="memory-disk"
            onError={() => setCoverFailed(true)}
            accessibilityIgnoresInvertColors
          />
        )}
      </View>

      <Text
        numberOfLines={2}
        style={{
          color: colors.text,
          fontSize: fontSize.h2,
          fontWeight: fontWeight.semibold,
          textAlign: 'center'
        }}
      >
        {title}
      </Text>

      <View style={[styles.stageRow, { gap: spacing.sm }]}>
        <ActivityIndicator color={colors.accent} />
        <Text
          style={{
            color: colors.textMuted,
            fontSize: fontSize.body,
            fontWeight: fontWeight.medium
          }}
        >
          {stageLabel}
        </Text>
      </View>

      <View style={[styles.progressBlock, { gap: spacing.xs }]}>
        <ProgressBar progress={ratio} height={8} />
        <Text
          style={{
            color: colors.textMuted,
            fontSize: fontSize.caption,
            textAlign: 'center'
          }}
        >
          {subtitle}
        </Text>
      </View>

      <Button title="Cancel" variant="secondary" onPress={onCancel} fullWidth />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cover: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  coverImage: { width: '100%', height: '100%' },
  stageRow: { flexDirection: 'row', alignItems: 'center' },
  progressBlock: { alignSelf: 'stretch' }
});
