import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NAV_SECTIONS, findNavSection, phaseLabel } from '@emden/shared';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';

// Nur geplante Bereiche laufen über diese Route; alles andere ergibt 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return NAV_SECTIONS.filter((s) => !s.available).map((s) => ({ section: s.slug }));
}

type Props = { params: Promise<{ section: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const section = findNavSection((await params).section);
  return { title: section?.label ?? 'Nicht gefunden' };
}

export default async function PlannedSectionPage({ params }: Props) {
  const section = findNavSection((await params).section);
  if (!section || section.available) notFound();

  return (
    <>
      <PageHeader
        title={section.label}
        intro={section.description}
        aside={<StatusBadge tone="planned">Geplant für Phase {section.phase}</StatusBadge>}
      />
      <EmptyState title="Noch nicht verfügbar">
        <p>
          Dieser Bereich wird in Phase {section.phase} ({phaseLabel(section.phase)}) umgesetzt. Bis dahin
          zeigt er bewusst keine Daten und keine Bedienelemente, damit nichts funktionsfähig wirkt, was es
          noch nicht ist.
        </p>
      </EmptyState>
    </>
  );
}
