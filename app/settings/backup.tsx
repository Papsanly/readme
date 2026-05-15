import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { SectionHeader } from '@/src/components/settings';
import { IconSymbol, Screen } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';
import {
  applyBackup,
  readBackupFromUri,
  writeBackupToCache,
  type ImportSummary
} from '@/src/pipeline/backup';

export default function BackupSettingsScreen() {
  const { colors, spacing, fontSize, fontWeight, radius } = useTheme();
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);

  const handleExport = useCallback(async () => {
    if (busy) return;
    setBusy('export');
    try {
      const { uri } = await writeBackupToCache();
      // RN's built-in Share API hands the URI to the system share sheet
      // (Files / Drive / AirDrop / email / etc.) — no extra deps required.
      await Share.share({ url: uri, title: 'readme library backup' });
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [busy]);

  const handleImport = useCallback(async () => {
    if (busy) return;
    setBusy('import');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain'],
        copyToCacheDirectory: true,
        multiple: false
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      const backup = await readBackupFromUri(asset.uri);
      const summary = applyBackup(backup);
      Alert.alert('Import complete', summaryToMessage(summary));
    } catch (err) {
      Alert.alert('Import failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [busy]);

  return (
    <Screen scroll padded={false}>
      <SectionHeader title="Export" />
      <View style={[styles.section, { paddingHorizontal: spacing.lg, gap: spacing.sm }]}>
        <Text style={{ color: colors.textMuted, fontSize: fontSize.caption }}>
          Save a JSON snapshot of your library metadata, per-book settings, and global preferences.
          Source files and audio cache are not included; you&apos;ll need to re-import the source
          on another device to resume processing.
        </Text>
        <Pressable
          onPress={() => void handleExport()}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityLabel="Export library backup"
          style={({ pressed }) => [
            styles.button,
            {
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.md,
              borderRadius: radius.md,
              backgroundColor: colors.accent,
              opacity: busy !== null ? 0.4 : pressed ? 0.7 : 1,
              gap: spacing.sm
            }
          ]}
        >
          <IconSymbol
            name="square.and.arrow.up"
            size={18}
            color={colors.accentText}
            weight="medium"
          />
          <Text
            style={{
              color: colors.accentText,
              fontSize: fontSize.body,
              fontWeight: fontWeight.semibold
            }}
          >
            {busy === 'export' ? 'Exporting…' : 'Export backup'}
          </Text>
        </Pressable>
      </View>

      <SectionHeader title="Import" />
      <View style={[styles.section, { paddingHorizontal: spacing.lg, gap: spacing.sm }]}>
        <Text style={{ color: colors.textMuted, fontSize: fontSize.caption }}>
          Restore from a previously exported backup file. Existing books are kept untouched — only
          new entries are added.
        </Text>
        <Pressable
          onPress={() => void handleImport()}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityLabel="Import library backup"
          style={({ pressed }) => [
            styles.button,
            {
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.md,
              borderRadius: radius.md,
              backgroundColor: colors.bgElevated,
              borderWidth: 1,
              borderColor: colors.border,
              opacity: busy !== null ? 0.4 : pressed ? 0.7 : 1,
              gap: spacing.sm
            }
          ]}
        >
          <IconSymbol name="square.and.arrow.down" size={18} color={colors.text} weight="medium" />
          <Text
            style={{
              color: colors.text,
              fontSize: fontSize.body,
              fontWeight: fontWeight.semibold
            }}
          >
            {busy === 'import' ? 'Importing…' : 'Import backup'}
          </Text>
        </Pressable>
      </View>

      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

function summaryToMessage(summary: ImportSummary): string {
  const parts: string[] = [];
  if (summary.restoredBooks > 0) parts.push(`${summary.restoredBooks} book(s) restored`);
  if (summary.skippedBooks > 0) parts.push(`${summary.skippedBooks} already in library — skipped`);
  if (summary.settingsApplied) parts.push('Global settings applied');
  return parts.length > 0 ? parts.join('. ') + '.' : 'Nothing imported.';
}

const styles = StyleSheet.create({
  section: { paddingBottom: 16 },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }
});
