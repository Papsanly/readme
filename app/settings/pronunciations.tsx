import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { SectionHeader } from '@/src/components/settings';
import { Button, EmptyState, IconSymbol, Screen } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';
import { useSettingsStore } from '@/src/state/settings';
import type { PronunciationOverride } from '@/src/types/settings';
import { useState } from 'react';

export default function PronunciationsSettingsScreen() {
  const { colors, radius, spacing, fontSize, fontWeight } = useTheme();
  const pronunciations = useSettingsStore(s => s.pronunciations);
  const addPronunciation = useSettingsStore(s => s.addPronunciation);
  const removePronunciation = useSettingsStore(s => s.removePronunciation);

  const [term, setTerm] = useState('');
  const [pronunciation, setPronunciation] = useState('');

  const canSave = term.trim().length > 0 && pronunciation.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;
    addPronunciation(term, pronunciation);
    setTerm('');
    setPronunciation('');
  };

  const handleRemove = (item: PronunciationOverride) => {
    Alert.alert('Delete pronunciation?', `Remove pronunciation override for "${item.term}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removePronunciation(item.id) }
    ]);
  };

  return (
    <Screen scroll padded={false}>
      <SectionHeader title="Add pronunciation" />
      <View style={[styles.section, { paddingHorizontal: spacing.lg, gap: spacing.md }]}>
        <View style={{ gap: spacing.xs }}>
          <Text
            style={{
              color: colors.text,
              fontSize: fontSize.body,
              fontWeight: fontWeight.semibold
            }}
          >
            Term in the book
          </Text>
          <TextInput
            value={term}
            onChangeText={setTerm}
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.input,
              {
                backgroundColor: colors.bgElevated,
                borderColor: colors.border,
                borderRadius: radius.md,
                color: colors.text,
                fontSize: fontSize.body,
                paddingHorizontal: spacing.md
              }
            ]}
          />
        </View>

        <View style={{ gap: spacing.xs }}>
          <Text
            style={{
              color: colors.text,
              fontSize: fontSize.body,
              fontWeight: fontWeight.semibold
            }}
          >
            Pronounce as
          </Text>
          <TextInput
            value={pronunciation}
            onChangeText={setPronunciation}
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.input,
              {
                backgroundColor: colors.bgElevated,
                borderColor: colors.border,
                borderRadius: radius.md,
                color: colors.text,
                fontSize: fontSize.body,
                paddingHorizontal: spacing.md
              }
            ]}
          />
        </View>

        <View
          style={[
            styles.tip,
            {
              backgroundColor: colors.bgElevated,
              borderColor: colors.border,
              borderRadius: radius.md,
              padding: spacing.md,
              gap: spacing.sm
            }
          ]}
        >
          <IconSymbol name="speaker.wave.2.fill" size={18} color={colors.accent} />
          <Text
            style={{
              color: colors.textMuted,
              flex: 1,
              fontSize: fontSize.caption,
              lineHeight: fontSize.caption * 1.45
            }}
          >
            Write it the way it should sound. To mark stress, make the stressed letter uppercase.
          </Text>
        </View>

        <Button title="Save" onPress={handleSave} disabled={!canSave} fullWidth />
      </View>

      <SectionHeader title="Dictionary" />
      {pronunciations.length === 0 ? (
        <EmptyState
          icon="speaker.wave.2.fill"
          title="No pronunciations yet"
          description="Add terms that the model or TTS should pronounce in a special way. New audio generation will use them."
          style={{ minHeight: 260 }}
        />
      ) : (
        <View style={[styles.list, { paddingHorizontal: spacing.lg, gap: spacing.sm }]}>
          {pronunciations.map(item => (
            <View
              key={item.id}
              style={[
                styles.item,
                {
                  backgroundColor: colors.bgElevated,
                  borderRadius: radius.lg,
                  padding: spacing.md,
                  gap: spacing.md
                }
              ]}
            >
              <View style={styles.itemText}>
                <Text
                  style={{
                    color: colors.text,
                    fontSize: fontSize.bodyLg,
                    fontWeight: fontWeight.semibold
                  }}
                  numberOfLines={1}
                >
                  {item.term}
                </Text>
                <Text
                  style={{
                    color: colors.textMuted,
                    fontSize: fontSize.body,
                    marginTop: 2
                  }}
                  numberOfLines={2}
                >
                  Pronounce as: {item.pronunciation}
                </Text>
              </View>
              <Pressable
                onPress={() => handleRemove(item)}
                accessibilityRole="button"
                accessibilityLabel={`Delete pronunciation for ${item.term}`}
                hitSlop={8}
                style={({ pressed }) => [styles.deleteButton, { opacity: pressed ? 0.6 : 1 }]}
              >
                <IconSymbol name="trash" size={20} color={colors.danger} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { paddingBottom: 16 },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth
  },
  tip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth
  },
  list: { paddingBottom: 16 },
  item: { flexDirection: 'row', alignItems: 'center' },
  itemText: { flex: 1, minWidth: 0 },
  deleteButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }
});
