import Ionicons from '@expo/vector-icons/Ionicons';
import { setAudioModeAsync } from 'expo-audio';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PdfRendererHost } from '@/src/components/pdf/PdfRenderer';
import { useTheme } from '@/src/hooks/useTheme';

export default function RootLayout() {
  const { colors, scheme } = useTheme();

  // Bundles the Ionicons TTF on web/Android so glyphs render — on iOS the icon
  // layer falls back to SF Symbols and never reads from this font.
  useFonts(Ionicons.font);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix'
    }).catch((err: unknown) => {
      console.error('Failed to configure audio mode', err);
    });
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            contentStyle: { backgroundColor: colors.bg },
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerShadowVisible: false
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="player/[id]" options={{ headerShown: false }} />
          <Stack.Screen
            name="book-settings/[id]"
            options={{ headerShown: true, title: 'Reading settings' }}
          />
          <Stack.Screen
            name="upload/[id]"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen name="settings/voice" options={{ headerShown: true, title: 'Voice' }} />
          <Stack.Screen
            name="settings/skipping"
            options={{ headerShown: true, title: 'Block skipping' }}
          />
          <Stack.Screen
            name="settings/tts-provider"
            options={{ headerShown: true, title: 'TTS provider' }}
          />
          <Stack.Screen
            name="settings/local-voice"
            options={{ headerShown: true, title: 'Local voice' }}
          />
          <Stack.Screen
            name="settings/pronunciations"
            options={{ headerShown: true, title: 'Pronunciations' }}
          />
          <Stack.Screen name="settings/about" options={{ headerShown: true, title: 'About' }} />
          <Stack.Screen
            name="settings/backup"
            options={{ headerShown: true, title: 'Backup & restore' }}
          />
        </Stack>
        <PdfRendererHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
