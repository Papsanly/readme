import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';

import { Button } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';

export type UrlSheetProps = {
  visible: boolean;
  onSubmit: (url: string) => void;
  onClose: () => void;
};

function isValidUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return /^https?:\/\/\S+/i.test(trimmed);
}

export function UrlSheet({ visible, onSubmit, onClose }: UrlSheetProps) {
  const { colors, radius, spacing, fontSize, fontWeight } = useTheme();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (visible) {
      setValue('');
      setError(undefined);
    }
  }, [visible]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!isValidUrl(trimmed)) {
      setError('Enter a URL starting with http:// or https://');
      return;
    }
    setError(undefined);
    onSubmit(trimmed);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <Pressable
          style={[styles.backdrop, { backgroundColor: colors.overlay }]}
          accessibilityRole="button"
          accessibilityLabel="Dismiss URL input"
          onPress={onClose}
        />
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
          <Text
            style={{
              color: colors.text,
              fontSize: fontSize.title,
              fontWeight: fontWeight.semibold
            }}
          >
            Add from URL
          </Text>

          <TextInput
            value={value}
            onChangeText={text => {
              setValue(text);
              if (error) setError(undefined);
            }}
            onSubmitEditing={handleSubmit}
            placeholder="https://example.com/book.pdf"
            placeholderTextColor={colors.textMuted}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            keyboardType="url"
            returnKeyType="go"
            inputMode="url"
            accessibilityLabel="Document URL"
            style={[
              styles.input,
              {
                backgroundColor: colors.bgElevated,
                borderColor: error ? colors.danger : colors.border,
                borderRadius: radius.md,
                paddingHorizontal: spacing.md,
                color: colors.text,
                fontSize: fontSize.body
              }
            ]}
          />

          {error ? (
            <Text style={{ color: colors.danger, fontSize: fontSize.caption }}>{error}</Text>
          ) : null}

          <View style={[styles.actions, { gap: spacing.sm }]}>
            <Button
              title="Cancel"
              variant="secondary"
              onPress={onClose}
              style={styles.actionFlex}
            />
            <Button
              title="Add"
              variant="primary"
              onPress={handleSubmit}
              disabled={value.trim().length === 0}
              style={styles.actionFlex}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0
  },
  input: {
    height: 48,
    borderWidth: StyleSheet.hairlineWidth
  },
  actions: { flexDirection: 'row' },
  actionFlex: { flex: 1 }
});
