import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';

const ICON_SOURCE = require('@/assets/images/icon.png') as number;

function getAppVersion(): string {
  const fromConfig = Constants.expoConfig?.version;
  if (typeof fromConfig === 'string' && fromConfig.length > 0) {
    return `${fromConfig} (MVP)`;
  }
  return '1.0.0 (MVP)';
}

export default function AboutSettingsScreen() {
  const { colors, radius, spacing, fontSize, fontWeight } = useTheme();

  return (
    <Screen scroll>
      <View style={[styles.center, { gap: spacing.lg, paddingVertical: spacing.lg }]}>
        <View
          style={[
            styles.iconWrap,
            {
              backgroundColor: colors.bgElevated,
              borderRadius: radius.xl
            }
          ]}
        >
          <Image
            source={ICON_SOURCE}
            style={styles.icon}
            contentFit="cover"
            transition={150}
            accessibilityIgnoresInvertColors
          />
        </View>

        <View style={{ alignItems: 'center', gap: spacing.xs }}>
          <Text
            style={{
              color: colors.text,
              fontSize: fontSize.h2,
              fontWeight: fontWeight.bold
            }}
          >
            readme
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: fontSize.body }}>
            {getAppVersion()}
          </Text>
        </View>

        <Text
          style={{
            color: colors.text,
            fontSize: fontSize.body,
            textAlign: 'center',
            maxWidth: 320,
            lineHeight: 22
          }}
        >
          readme converts documents into high-quality audiobooks using a vision language model and
          ElevenLabs text-to-speech.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center' },
  iconWrap: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden'
  },
  icon: { width: '100%', height: '100%' }
});
