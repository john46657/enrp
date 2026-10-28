import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';

export default function NotFound() {
  return (
    <EmptyState title="Seite nicht gefunden">
      <p>Diese Adresse gibt es im Control Center nicht.</p>
      <p>
        <Link href="/">Zur Übersicht</Link>
      </p>
    </EmptyState>
  );
}
