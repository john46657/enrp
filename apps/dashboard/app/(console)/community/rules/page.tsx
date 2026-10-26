'use client';

import { useQuery } from '@tanstack/react-query';
import { ActionDialog } from '@/components/data/action-dialog';
import { Button, EmptyState, ErrorState, PageHeader, Panel, Skeleton, StatusBadge } from '@/components/ui/primitives';
import { get, post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface RuleSet {
  id: string;
  version: number;
  title: string;
  content: string;
  status: string;
  publishedAt: string | null;
  createdAt: string;
  acceptances: number;
}

export default function RulesPage() {
  const can = useCan();
  const q = useQuery({ queryKey: ['rules'], queryFn: () => get<{ items: RuleSet[] }>('/rules/versions') });
  const invalidate = [['rules']];
  const current = q.data?.items.find((r) => r.status === 'published');
  return (
    <>
      <PageHeader
        title="Regelwerk"
        description="Versioniert. Mit /rules accept bestätigen Mitglieder die jeweils veröffentlichte Version."
        actions={
          can('rules:edit') && (
            <ActionDialog
              title="Neue Version entwerfen"
              submitLabel="Entwurf speichern"
              fields={[
                { name: 'title', label: 'Titel', required: true, defaultValue: current?.title ?? 'Regelwerk' },
                {
                  name: 'content',
                  label: 'Inhalt (Markdown)',
                  type: 'textarea',
                  required: true,
                  defaultValue: current?.content,
                },
              ]}
              onSubmit={(v) => post('/rules', v)}
              invalidate={invalidate}
              trigger={(o) => (
                <Button variant="primary" onClick={o}>
                  Neue Version
                </Button>
              )}
            />
          )
        }
      />
      {q.isLoading ? (
        <Skeleton />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : !q.data!.items.length ? (
        <EmptyState title="Noch kein Regelwerk">Lege eine erste Version an und veröffentliche sie.</EmptyState>
      ) : (
        <div className="space-y-4">
          {q.data!.items.map((r) => (
            <Panel
              key={r.id}
              title={`Version ${r.version}: ${r.title}`}
              actions={
                <>
                  <StatusBadge status={r.status} />
                  {r.status === 'draft' && can('rules:publish') && (
                    <ActionDialog
                      title={`Version ${r.version} veröffentlichen`}
                      description="Die bisherige Version wird archiviert. Mitglieder müssen die neue Version erneut bestätigen."
                      submitLabel="Veröffentlichen"
                      fields={[]}
                      onSubmit={() => post(`/rules/${r.id}/publish`)}
                      invalidate={invalidate}
                      trigger={(o) => (
                        <Button size="sm" onClick={o}>
                          Veröffentlichen
                        </Button>
                      )}
                    />
                  )}
                </>
              }
            >
              <p className="text-sm text-muted">
                {r.publishedAt
                  ? `Veröffentlicht ${fmtDateTime(r.publishedAt)}, ${r.acceptances} Bestätigungen`
                  : `Entwurf vom ${fmtDateTime(r.createdAt)}`}
              </p>
              <pre className="mt-3 max-h-80 overflow-auto font-sans text-sm whitespace-pre-wrap">{r.content}</pre>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
