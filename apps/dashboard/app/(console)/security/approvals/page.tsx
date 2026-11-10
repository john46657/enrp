'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActionDialog } from '@/components/data/action-dialog';
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  Select,
  Skeleton,
  StatusBadge,
} from '@/components/ui/primitives';
import { get, post } from '@/lib/api';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { useCan, useSession } from '@/lib/session';

interface Approval {
  id: string;
  number: number;
  actionType: string;
  summary: string;
  payload: unknown;
  reason: string;
  requestedBy: string;
  status: string;
  decidedBy: string | null;
  decisionReason: string | null;
  expiresAt: string;
  createdAt: string;
}

export default function ApprovalsPage() {
  const can = useCan();
  const me = useSession();
  const [status, setStatus] = useState('pending');
  const q = useQuery({
    queryKey: ['list', '/approvals', status],
    queryFn: () => get<{ items: Approval[] }>('/approvals', { status: status || undefined }),
  });
  const invalidate = [['list', '/approvals'], ['overview']];
  return (
    <>
      <PageHeader
        title="Freigabezentrum"
        description="Kritische Aktionen (Rechte, Wiederherstellungen, Löschanträge) werden erst nach Zustimmung einer zweiten Person ausgeführt – genau einmal und nur vor Ablauf."
        actions={
          <Select aria-label="Status" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="pending">Ausstehend</option>
            <option value="executed">Ausgeführt</option>
            <option value="rejected">Abgelehnt</option>
            <option value="expired">Abgelaufen</option>
            <option value="cancelled">Zurückgezogen</option>
            <option value="">Alle</option>
          </Select>
        }
      />
      {q.isLoading ? (
        <Skeleton />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : !q.data!.items.length ? (
        <EmptyState title="Keine Freigabeanfragen in dieser Ansicht" />
      ) : (
        <div className="space-y-3">
          {q.data!.items.map((a) => {
            const own = a.requestedBy === me.user.id;
            return (
              <Panel
                key={a.id}
                title={`#${a.number} ${a.summary}`}
                actions={
                  a.status === 'pending' && (
                    <>
                      {can('approvals:approve') && !own && (
                        <>
                          <ActionDialog
                            title={`Freigabe #${a.number} genehmigen`}
                            description="Die Aktion wird sofort ausgeführt."
                            submitLabel="Genehmigen und ausführen"
                            requireReason
                            fields={[]}
                            onSubmit={(v, k) =>
                              post(`/approvals/${a.id}/decide`, { decision: 'approve', reason: v.reason }, k)
                            }
                            invalidate={invalidate}
                            trigger={(open) => (
                              <Button variant="primary" size="sm" onClick={open}>
                                Genehmigen
                              </Button>
                            )}
                          />
                          <ActionDialog
                            title={`Freigabe #${a.number} ablehnen`}
                            submitLabel="Ablehnen"
                            danger
                            requireReason
                            fields={[]}
                            onSubmit={(v, k) =>
                              post(`/approvals/${a.id}/decide`, { decision: 'reject', reason: v.reason }, k)
                            }
                            invalidate={invalidate}
                            trigger={(open) => (
                              <Button variant="danger" size="sm" onClick={open}>
                                Ablehnen
                              </Button>
                            )}
                          />
                        </>
                      )}
                      {own && (
                        <ActionDialog
                          title="Anfrage zurückziehen"
                          submitLabel="Zurückziehen"
                          requireReason
                          fields={[]}
                          onSubmit={(v) => post(`/approvals/${a.id}/cancel`, v)}
                          invalidate={invalidate}
                          trigger={(open) => (
                            <Button size="sm" onClick={open}>
                              Zurückziehen
                            </Button>
                          )}
                        />
                      )}
                    </>
                  )
                }
              >
                <div className="grid gap-4 text-sm md:grid-cols-[1fr_1fr]">
                  <div className="space-y-1">
                    <p>
                      <StatusBadge status={a.status} /> <span className="text-muted">Typ {a.actionType}</span>
                    </p>
                    <p>
                      Beantragt von {own ? 'dir' : a.requestedBy}, {fmtDateTime(a.createdAt)}
                    </p>
                    <p>Begründung: {a.reason}</p>
                    {a.status === 'pending' && <p className="text-muted">Läuft {fmtRelative(a.expiresAt)} ab.</p>}
                    {a.decidedBy && (
                      <p>
                        Entschieden von {a.decidedBy}: {a.decisionReason}
                      </p>
                    )}
                    {own && a.status === 'pending' && (
                      <p className="text-muted">Eigene Anfragen kann nur eine andere Person entscheiden.</p>
                    )}
                  </div>
                  <pre className="max-h-48 overflow-auto rounded bg-bg p-2 text-xs">
                    {JSON.stringify(a.payload, null, 2)}
                  </pre>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
