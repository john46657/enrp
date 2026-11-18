'use client';

import Link from 'next/link';
import { ResourceTable } from '@/components/data/resource-table';
import { Badge, PageHeader, Panel, StatusBadge } from '@/components/ui/primitives';
import { fmtDateTime } from '@/lib/format';

interface LinkRow {
  id: string;
  status: string;
  discordUserId: string;
  discordUsername: string | null;
  robloxUserId: number;
  robloxUsername: string;
  verifiedAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
}
interface Attempt {
  id: string;
  discordUserId: string;
  robloxUserId: number | null;
  outcome: string;
  failureReason: string | null;
  createdAt: string;
}

export default function VerificationPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Verifizierung & Kontoverknüpfungen"
        description="Verknüpfungen entstehen ausschließlich über den Roblox-OAuth-Ablauf (/verify). Dabei wird nur die Rolle „Verifiziert“ vergeben."
      />
      <Panel title="Kontoverknüpfungen">
        <ResourceTable<LinkRow>
          path="/verification/links"
          rowKey={(r) => r.id}
          filters={[
            {
              name: 'status',
              label: 'Status',
              options: [
                { value: 'active', label: 'Aktiv' },
                { value: 'revoked', label: 'Aufgehoben' },
              ],
            },
          ]}
          emptyTitle="Noch keine Verknüpfungen"
          columns={[
            {
              key: 'roblox',
              header: 'Roblox',
              render: (r) => (
                <Link className="hover:underline" href={`/players/roblox/${r.robloxUserId}`}>
                  {r.robloxUsername} ({r.robloxUserId})
                </Link>
              ),
              sortValue: (r) => r.robloxUsername,
            },
            { key: 'discord', header: 'Discord', render: (r) => `${r.discordUsername ?? ''} (${r.discordUserId})` },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            {
              key: 'verified',
              header: 'Verifiziert am',
              render: (r) => fmtDateTime(r.verifiedAt),
              sortValue: (r) => r.verifiedAt,
            },
            {
              key: 'revoked',
              header: 'Aufgehoben',
              render: (r) => (r.revokedAt ? `${fmtDateTime(r.revokedAt)}: ${r.revokeReason ?? ''}` : '–'),
            },
          ]}
        />
      </Panel>
      <Panel title="Letzte Versuche">
        <ResourceTable<Attempt>
          path="/verification/attempts"
          searchable={false}
          rowKey={(r) => r.id}
          emptyTitle="Keine Versuche protokolliert"
          columns={[
            { key: 'at', header: 'Zeitpunkt', render: (r) => fmtDateTime(r.createdAt) },
            { key: 'discord', header: 'Discord-ID', render: (r) => r.discordUserId },
            {
              key: 'outcome',
              header: 'Ergebnis',
              render: (r) =>
                r.outcome === 'success' ? (
                  <Badge tone="ok">Erfolgreich</Badge>
                ) : (
                  <Badge tone="bad">Fehlgeschlagen</Badge>
                ),
            },
            { key: 'reason', header: 'Grund', render: (r) => r.failureReason ?? '–' },
          ]}
        />
      </Panel>
    </div>
  );
}
