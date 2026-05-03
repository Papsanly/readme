import { EmptyState, Screen } from '@/src/components/ui';

export default function LibraryScreen() {
  return (
    <Screen>
      <EmptyState
        icon="book"
        title="Your library"
        description="Library coming up. Upload a document to start listening."
      />
    </Screen>
  );
}
