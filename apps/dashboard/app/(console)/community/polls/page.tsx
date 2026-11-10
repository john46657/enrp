'use client';

import { ActionDialog } from '@/components/data/action-dialog';
import { ResourceTable } from '@/components/data/resource-table';
import { Button, PageHeader, StatusBadge } from '@/components/ui/primitives';
import { get, post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';

interface Row {
  poll: {
    id: string;
    question: string;
    status: string;
    closesAt: string | null;
    multipleChoice: boolean;
    createdAt: string;
  };
  voters: number;
}

function Results({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['poll', id],
    queryFn: () =>
      get<{ poll: { question: string }; voters: number; results: Array<{ id: string; label: string; votes: number }> }>(
        `/polls/${id}`,
      ),
    enabled: Boolean(id),
  });
  const max = Math.max(1, ...(q.data?.results.map((r) => r.votes) ?? [1]));
  return (
    <Dialog open={Boolean(id)} onClose={onClose} title={q.data?.poll.question ?? 'Ergebnis'}>
      <ul className="space-y-3">
        {q.data?.results.map((r) => (
          <li key={r.id}>
            <div className="flex justify-between text-sm">
              <span>{r.label}</span>
              <span className="tabular">{r.votes}</span>
            </div>
            <div className="mt-1 h-2 rounded bg-surface-2">
              <div className="h-2 rounded bg-info" style={{ width: `${(r.votes / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted">{q.data?.voters ?? 0} Teilnehmende</p>
    </Dialog>
  );
}

export default function PollsPage() {
  const can = useCan();
  const [open, setOpen] = useState<string | null>(null);
  const invalidate = [['list', '/polls']];
  return (
    <>
      <PageHeader
        title="Umfragen"
        description="Abstimmung über Buttons in Discord; jede Person hat eine Stimme, die sie ändern kann."
        actions={
          can('community:create') && (
            <ActionDialog
              title="Umfrage erstellen"
              submitLabel="Erstellen"
              fields={[
                { name: 'question', label: 'Frage', required: true },
                { name: 'options', label: 'Antworten (eine pro Zeile, 2–10)', type: 'textarea', required: true },
                { name: 'channelId', label: 'Discord-Kanal-ID', required: true },
                { name: 'durationHours', label: 'Laufzeit in Stunden', type: 'number' },
                { name: 'multipleChoice', label: 'Mehrfachauswahl', type: 'checkbox' },
              ]}
              onSubmit={(v) =>
                post('/polls', {
                  ...v,
                  options: String(v.options)
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              invalidate={invalidate}
              trigger={(o) => (
                <Button variant="primary" onClick={o}>
                  Umfrage erstellen
                </Button>
              )}
            />
          )
        }
      />
      <ResourceTable<Row>
        path="/polls"
        searchable={false}
        rowKey={(r) => r.poll.id}
        filters={[
          {
            name: 'status',
            label: 'Status',
            options: [
              { value: 'open', label: 'Offen' },
              { value: 'closed', label: 'Beendet' },
            ],
          },
        ]}
        emptyTitle="Keine Umfragen"
        columns={[
          {
            key: 'q',
            header: 'Frage',
            render: (r) => (
              <button className="text-left font-medium hover:underline" onClick={() => setOpen(r.poll.id)}>
                {r.poll.question}
              </button>
            ),
          },
          {
            key: 's',
            header: 'Status',
            render: (r) => <StatusBadge status={r.poll.status === 'closed' ? 'completed' : 'open'} />,
          },
          { key: 'v', header: 'Teilnehmende', render: (r) => r.voters, sortValue: (r) => r.voters },
          { key: 'e', header: 'Endet', render: (r) => fmtDateTime(r.poll.closesAt) },
          {
            key: 'x',
            header: '',
            render: (r) =>
              r.poll.status === 'open' && can('community:edit') ? (
                <ActionDialog
                  title="Umfrage beenden"
                  submitLabel="Beenden"
                  fields={[]}
                  onSubmit={() => post(`/polls/${r.poll.id}/close`)}
                  invalidate={invalidate}
                  trigger={(o) => (
                    <Button size="sm" onClick={o}>
                      Beenden
                    </Button>
                  )}
                />
              ) : null,
          },
        ]}
      />
      <Results id={open} onClose={() => setOpen(null)} />
    </>
  );
}
