'use client';

import { useQuery } from '@tanstack/react-query';
import { ActionDialog } from '@/components/data/action-dialog';
import { Badge, Button, EmptyState, ErrorState, KeyValues, PageHeader, Panel, Skeleton, StatusBadge } from '@/components/ui/primitives';
import { get, post } from '@/lib/api';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Backup {
  id: string;
  kind: string;
  status: string;
  fileName: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  verifiedAt: string | null;
  error: string | null;
  triggeredBy: string;
  startedAt: string;
  finishedAt: string | null;
  expiresAt: string | null;
  deletedAt: string | null;
}
interface Restore {
  id: string;
  backupId: string;
  targetEnvironment: string;
  status: string;
  requestedBy: string;
  reason: string;
  createdAt: string;
}
interface Data {
  health: { lastSuccessAt: string | null; hoursSinceSuccess: number | null; consecutiveFailures: number };
  items: Backup[];
  restores: Restore[];
}

const ENVIRONMENTS = [
  { value: 'restore_test', label: 'Testdatenbank (restore_test)' },
  { value: 'development', label: 'Entwicklung' },
  { value: 'staging', label: 'Staging' },
  { value: 'production', label: 'Produktion (Vier-Augen-Freigabe)' },
];

function fmtSize(bytes: number | null) {
  if (bytes === null) return '–';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function BackupsPage() {
  const can = useCan();
  const q = useQuery({ queryKey: ['backups'], queryFn: () => get<Data>('/backups'), refetchInterval: 15_000 });
  if (q.isLoading) return <Skeleton />;
  if (q.error) return <ErrorState error={q.error} />;
  const { health, items, restores } = q.data!;
  const stale = health.hoursSinceSuccess === null || health.hoursSinceSuccess > 26;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backups"
        description="Tägliche Sicherung der Datenbank durch den Worker; jedes Backup wird per Test-Wiederherstellung geprüft."
        actions={
          can('backups:create') && (
            <ActionDialog
              title="Backup jetzt erstellen"
              description="Der Worker erstellt die Sicherung im Hintergrund und prüft sie anschließend."
              submitLabel="Backup starten"
              fields={[]}
              onSubmit={() => post('/backups/run', {})}
              successMessage="Backup angestoßen"
              invalidate={[['backups']]}
              trigger={(open) => <Button onClick={open}>Backup jetzt erstellen</Button>}
            />
          )
        }
      />
      <Panel title="Zustand">
        <KeyValues
          items={[
            [
              'Letztes geprüftes Backup',
              health.lastSuccessAt ? (
                <span key="l">
                  {fmtDateTime(health.lastSuccessAt)} ({fmtRelative(health.lastSuccessAt)}){' '}
                  {stale && <Badge tone="warn">älter als 26 Stunden</Badge>}
                </span>
              ) : (
                <Badge key="l" tone="warn">
                  noch keines
                </Badge>
              ),
            ],
            [
              'Fehlschläge in Folge',
              health.consecutiveFailures ? (
                <Badge key="f" tone="bad">
                  {health.consecutiveFailures}
                </Badge>
              ) : (
                '0'
              ),
            ],
          ]}
        />
      </Panel>
      <Panel title="Sicherungen">
        {items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1.5 font-medium">Gestartet</th>
                  <th className="font-medium">Art</th>
                  <th className="font-medium">Status</th>
                  <th className="font-medium">Größe</th>
                  <th className="font-medium">Geprüft</th>
                  <th className="font-medium">Datei</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((b) => (
                  <tr key={b.id}>
                    <td className="py-1.5 whitespace-nowrap">{fmtDateTime(b.startedAt)}</td>
                    <td>{b.kind === 'scheduled' ? 'Geplant' : b.kind === 'manual' ? 'Manuell' : b.kind}</td>
                    <td>
                      <StatusBadge status={b.deletedAt ? 'expired' : b.status} />
                      {b.error && <p className="text-xs text-bad">{b.error}</p>}
                    </td>
                    <td className="tabular">{fmtSize(b.sizeBytes)}</td>
                    <td>{fmtDateTime(b.verifiedAt)}</td>
                    <td className="max-w-56 truncate font-mono text-xs" title={b.sha256 ?? undefined}>
                      {b.fileName ?? '–'}
                    </td>
                    <td className="text-right">
                      {b.status === 'succeeded' && !b.deletedAt && can('backups:create') && (
                        <ActionDialog
                          title="Wiederherstellung beantragen"
                          description="Es wird zuerst eine Vorschau erstellt. Produktion braucht immer die Freigabe einer zweiten Person."
                          submitLabel="Beantragen"
                          danger
                          requireReason
                          fields={[
                            {
                              name: 'targetEnvironment',
                              label: 'Ziel',
                              type: 'select',
                              required: true,
                              options: ENVIRONMENTS,
                              defaultValue: 'restore_test',
                            },
                          ]}
                          onSubmit={(v) => post(`/backups/${b.id}/restore`, v)}
                          successMessage="Wiederherstellung beantragt"
                          invalidate={[['backups']]}
                          trigger={(open) => (
                            <Button size="sm" onClick={open}>
                              Wiederherstellen
                            </Button>
                          )}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Noch keine Backups">
            Der Worker erstellt täglich eine Sicherung. Läuft er nicht, bleibt diese Liste leer.
          </EmptyState>
        )}
      </Panel>
      <Panel title="Wiederherstellungen">
        <ul className="divide-y divide-line text-sm">
          {restores.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-1.5">
              <span className="w-40 shrink-0 text-muted">{fmtDateTime(r.createdAt)}</span>
              <span className="w-44 shrink-0">
                {ENVIRONMENTS.find((e) => e.value === r.targetEnvironment)?.label ?? r.targetEnvironment}
              </span>
              <StatusBadge status={r.status} />
              <span className="text-muted">Grund: {r.reason}</span>
            </li>
          ))}
          {!restores.length && <li className="text-muted">Keine Wiederherstellungen beantragt.</li>}
        </ul>
      </Panel>
    </div>
  );
}
