import { EmptyState } from '@/src/components/ui';

export type BookListEmptyProps = {
  onAddBook: () => void;
};

export function BookListEmpty({ onAddBook }: BookListEmptyProps) {
  return (
    <EmptyState
      icon="tray"
      title="No books yet"
      description="Add a PDF, image, or text file to start listening."
      ctaLabel="Add your first book"
      onCtaPress={onAddBook}
    />
  );
}
