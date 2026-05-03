import { EmptyState, Screen } from '@/src/components/ui';

export default function SettingsScreen() {
  return (
    <Screen>
      <EmptyState
        icon="gear"
        title="Settings"
        description="Settings coming up. Voice, speed, and skipping mode will live here."
      />
    </Screen>
  );
}
