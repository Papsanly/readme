import { EmptyState, Screen } from '@/src/components/ui';

export default function UploadScreen() {
  return (
    <Screen>
      <EmptyState
        icon="arrow.up.doc"
        title="Upload"
        description="Upload coming up. You'll be able to import a file or paste a URL."
      />
    </Screen>
  );
}
