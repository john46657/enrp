'use client';

import { useState } from 'react';
import { ActionDialog } from '@/components/data/action-dialog';
import { ResourceTable } from '@/components/data/resource-table';
import { Badge, Button, PageHeader } from '@/components/ui/primitives';
import { post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Code {
  id: string;
  hint: string;
  description: string;
  rewardType: string;
  rewardPayload: Record<string, unknown>;
  maxRedemptions: number | null;
  perUserLimit: number;
  redemptionCount: number;
  startsAt: string | null;
  expiresAt: string | null;
  status: string;
}

export default function CodesPage() {
  const can = useCan();
  const [created, setCreated] = useState<string | null>(null);
  const invalidate = [['list', '/codes']];
  return (
    <>
      <PageHeader
        title="Codes & Rewards"
        description="Codes werden im Spiel eingelöst. Das Backend prüft Limits, Zeitraum und Duplikate; die Belohnung vergibt der Spielserver. Codes werden nur gehasht gespeichert."
        actions={
          can('codes:create') && (
            <ActionDialog
              title="Code anlegen"
              submitLabel="Anlegen"
              fields={[
                { name: 'code', label: 'Code (leer = zufällig)', hint: 'A–Z, 0–9 und Bindestrich' },
                { name: 'description', label: 'Beschreibung' },
                {
                  name: 'rewardType',
                  label: 'Reward-Typ, wie im Spiel definiert',
                  required: true,
                  placeholder: 'cash',
                },
                { name: 'rewardPayload', label: 'Reward-Daten (JSON)', type: 'json', placeholder: '{"amount": 500}' },
                { name: 'maxRedemptions', label: 'Maximale Einlösungen gesamt', type: 'number', min: 1 },
                { name: 'perUserLimit', label: 'Einlösungen pro Spieler', type: 'number', defaultValue: 1, min: 1 },
                { name: 'startsAt', label: 'Gültig ab', type: 'datetime' },
                { name: 'expiresAt', label: 'Gültig bis', type: 'datetime' },
              ]}
              onSubmit={(v, k) => post<{ code: string }>('/codes', v, k)}
              onDone={(r) => setCreated((r as { code: string }).code)}
              successMessage="Code angelegt"
              invalidate={invalidate}
              trigger={(o) => (
                <Button variant="primary" onClick={o}>
                  Code anlegen
                </Button>
              )}
            />
          )
        }
      />
      {created && (
        <div className="mb-4 rounded-md border border-signal/60 bg-signal/10 p-3 text-sm" role="status">
          Neuer Code (wird nur jetzt angezeigt):{' '}
          <code className="ml-1 text-base font-semibold select-all">{created}</code>
          <Button size="sm" className="ml-3" onClick={() => setCreated(null)}>
            Ausblenden
          </Button>
        </div>
      )}
      <ResourceTable<Code>
        path="/codes"
        searchable={false}
        rowKey={(c) => c.id}
        emptyTitle="Noch keine Codes"
        columns={[
          { key: 'h', header: 'Code', render: (c) => <code>{c.hint}</code> },
          { key: 'r', header: 'Reward', render: (c) => `${c.rewardType} ${JSON.stringify(c.rewardPayload)}` },
          {
            key: 'n',
            header: 'Eingelöst',
            render: (c) =>
              `${c.redemptionCount}${c.maxRedemptions ? ` / ${c.maxRedemptions}` : ''} (max. ${c.perUserLimit} pro Spieler)`,
            sortValue: (c) => c.redemptionCount,
          },
          {
            key: 'z',
            header: 'Zeitraum',
            render: (c) =>
              `${c.startsAt ? fmtDateTime(c.startsAt) : 'sofort'} bis ${c.expiresAt ? fmtDateTime(c.expiresAt) : 'unbegrenzt'}`,
          },
          {
            key: 's',
            header: 'Status',
            render: (c) => (
              <Badge tone={c.status === 'active' ? 'ok' : 'muted'}>
                {c.status === 'active' ? 'aktiv' : 'deaktiviert'}
              </Badge>
            ),
          },
          {
            key: 'x',
            header: '',
            render: (c) =>
              can('codes:edit') ? (
                <ActionDialog
                  title={c.status === 'active' ? 'Code deaktivieren' : 'Code aktivieren'}
                  submitLabel={c.status === 'active' ? 'Deaktivieren' : 'Aktivieren'}
                  requireReason
                  fields={[]}
                  onSubmit={(v) =>
                    post(`/codes/${c.id}/status`, {
                      status: c.status === 'active' ? 'disabled' : 'active',
                      reason: v.reason,
                    })
                  }
                  invalidate={invalidate}
                  trigger={(o) => (
                    <Button size="sm" onClick={o}>
                      {c.status === 'active' ? 'Deaktivieren' : 'Aktivieren'}
                    </Button>
                  )}
                />
              ) : null,
          },
        ]}
      />
    </>
  );
}
