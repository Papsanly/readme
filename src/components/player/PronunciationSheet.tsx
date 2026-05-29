import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, IconSymbol } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';

export type PronunciationSheetProps = {
  visible: boolean;
  initialTerm?: string;
  onSave: (term: string, pronunciation: string) => void;
  onClose: () => void;
};

export function PronunciationSheet({
  visible,
  initialTerm,
  onSave,
  onClose
}: PronunciationSheetProps) {
  const { colors, radius, spacing, fontSize, fontWeight, scheme } = useTheme();
  const [term, setTerm] = useState(initialTerm ?? '');
  const [pronunciation, setPronunciation] = useState('');
  const pronunciationInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) return;
    setTerm(initialTerm ?? '');
    setPronunciation('');
    const id = setTimeout(() => pronunciationInputRef.current?.focus(), 250);
    return () => clearTimeout(id);
  }, [initialTerm, visible]);

  const canSave = term.trim().length > 0 && pronunciation.trim().length > 0;

  const handleClose = () => {
    Haptics.selectionAsync().catch(() => {});
    Keyboard.dismiss();
    onClose();
  };

  const handleSave = () => {
    if (!canSave) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onSave(term, pronunciation);
    Keyboard.dismiss();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView
        style={[styles.screen, { backgroundColor: colors.bg }]}
        edges={['top', 'left', 'right']}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardWrap}
        >
          <View
            style={[
              styles.header,
              {
                paddingHorizontal: spacing.lg,
                paddingTop: spacing.lg,
                paddingBottom: spacing.lg,
                borderBottomColor: colors.border
              }
            ]}
          >
            <Text
              style={{
                color: colors.text,
                fontSize: fontSize.h1,
                fontWeight: fontWeight.bold,
                flex: 1
              }}
            >
              Add pronunciation
            </Text>
            <Pressable
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Close add pronunciation"
              hitSlop={8}
              style={({ pressed }) => [
                styles.closeButton,
                {
                  backgroundColor: colors.bgElevated,
                  borderRadius: 28,
                  opacity: pressed ? 0.72 : 1
                }
              ]}
            >
              <IconSymbol name="xmark" size={24} color={colors.text} />
            </Pressable>
          </View>

          <View style={[styles.content, { padding: spacing.lg, gap: spacing.md }]}>
            <View style={{ gap: spacing.xs }}>
              <Text
                style={{
                  color: colors.text,
                  fontSize: fontSize.bodyLg,
                  fontWeight: fontWeight.semibold
                }}
              >
                Pronounce as
              </Text>
              <View
                style={[
                  styles.pronunciationInputWrap,
                  {
                    backgroundColor: colors.bgElevated,
                    borderColor: colors.border,
                    borderRadius: radius.lg,
                    paddingLeft: spacing.md,
                    paddingRight: spacing.sm
                  }
                ]}
              >
                <TextInput
                  ref={pronunciationInputRef}
                  value={pronunciation}
                  onChangeText={setPronunciation}
                  placeholder="Enter correct pronunciation"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => Keyboard.dismiss()}
                  style={[
                    styles.pronunciationInput,
                    { color: colors.text, fontSize: fontSize.bodyLg }
                  ]}
                />
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  style={[styles.previewButton, { opacity: canSave ? 0.55 : 0.3 }]}
                >
                  <IconSymbol name="play.fill" size={24} color={colors.textMuted} />
                </View>
              </View>
            </View>

            <TextInput
              value={term}
              onChangeText={setTerm}
              placeholder="Text in the book"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              selectTextOnFocus={initialTerm ? true : false}
              style={[
                styles.termInput,
                {
                  backgroundColor: scheme === 'dark' ? '#000000' : colors.bgElevated,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  color: colors.text,
                  fontSize: fontSize.bodyLg,
                  fontWeight: fontWeight.semibold,
                  paddingHorizontal: spacing.md
                }
              ]}
            />

            <View style={[styles.tip, { gap: spacing.xs }]}>
              <Text style={{ color: colors.textMuted, fontSize: fontSize.caption }}>ⓘ</Text>
              <Text
                style={{
                  color: colors.textMuted,
                  flex: 1,
                  fontSize: fontSize.caption,
                  lineHeight: fontSize.caption * 1.45
                }}
              >
                Write it the way it sounds (e.g., “Rhythm” → “RITH-uhm”) to apply to new audio
                generation going forward.
              </Text>
            </View>
          </View>

          <View style={[styles.footer, { padding: spacing.lg }]}>
            <Button title="Save" onPress={handleSave} disabled={!canSave} fullWidth />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  keyboardWrap: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  closeButton: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center'
  },
  content: { flex: 1 },
  pronunciationInputWrap: {
    minHeight: 76,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center'
  },
  pronunciationInput: { flex: 1, minHeight: 58 },
  previewButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center'
  },
  termInput: {
    minHeight: 58,
    borderWidth: StyleSheet.hairlineWidth
  },
  tip: { flexDirection: 'row', alignItems: 'flex-start' },
  footer: { width: '100%' }
});
