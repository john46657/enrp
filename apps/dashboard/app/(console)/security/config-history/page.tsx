'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { ErrorState, Input, PageHeader, Panel, Skeleton } from '@/components/ui/primitives';
import { get } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';

interface Version {
  id: string;
  scope: string;
  version: number;
  value: unknown;
  previous: unknown;
  actorId: string;
  reason: string | null;
  createdAt: string;
}

export default function ConfigHistoryPage() {
  const [scope, setScope] = useState('');
  const [open, setOpen] = useState<Version | null>(null);
  const q = useQuery({
    queryKey: ['config-history', scope],
    queryFn: () => get<{ items: Version[] }>('/config/history', { scope: scope || undefined, limit: 100 }),
  });
  return (
    <>
      <PageHeader
        title="Konfigurationshistorie"
        description="Jede Änderung an Einstellungen, Feature-Flags, Rollen und Befehlsrechten wird als Version mit vorherigem und neuem Zustand gespeichert."
      />
      <div className="mb-4 max-w-sm">
        <Input
          aria-label="Bereich"
          placeholder="Bereich, z. B. setting:duty oder feature_flag:kill_switch"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        />
      </div>
      <Panel>
        {q.isLoading ? (
          <Skeleton />
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : (
          <ul className="divide-y divide-line text-sm">
            {q.data!.items.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 py-2">
                <button className="font-mono text-xs hover:text-signal hover:underline" onClick={() => setOpen(v)}>
                  {v.scope} v{v.version}
                </button>
                <span className="text-muted">{fmtDateTime(v.createdAt)}</span>
                <span>{v.actorId}</span>
                <span className="text-muted">{v.reason}</span>
              </li>
            ))}
            {!q.data!.items.length && <li className="text-muted">Keine Versionen.</li>}
          </ul>
        )}
      </Panel>
      <Dialog
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open ? `${open.scope} v${open.version}` : ''}
        wide
      >
        {open && (
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="mb-1 text-sm text-muted">Vorher</p>
              <pre className="max-h-96 overflow-auto rounded bg-bg p-2 text-xs">
                {JSON.stringify(open.previous, null, 2)}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-sm text-muted">Nachher</p>
              <pre className="max-h-96 overflow-auto rounded bg-bg p-2 text-xs">
                {JSON.stringify(open.value, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
