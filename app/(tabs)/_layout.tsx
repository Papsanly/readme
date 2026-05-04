import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import { IconSymbol, type IconName } from '@/src/components/ui';
import { useTheme } from '@/src/hooks/useTheme';

export default function TabsLayout() {
  const { colors } = useTheme();

  return (
    <Tabs
      screenOptions={{
        // Each tab screen renders its own in-content title (Library, Upload,
        // Settings), so hiding the navigator header avoids the duplicate
        // title bar that otherwise stacks on top.
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Library',
          tabBarIcon: ({ color, size }) => (
            <IconSymbol name={'book' satisfies IconName} size={size} color={color} />
          )
        }}
      />
      <Tabs.Screen
        name="upload"
        options={{
          title: 'Upload',
          tabBarIcon: ({ color, size }) => (
            <IconSymbol name={'arrow.up.doc' satisfies IconName} size={size} color={color} />
          )
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <IconSymbol name={'gear' satisfies IconName} size={size} color={color} />
          )
        }}
      />
    </Tabs>
  );
}
