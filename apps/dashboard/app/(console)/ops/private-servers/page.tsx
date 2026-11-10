'use client';

import { useQuery } from '@tanstack/react-query';
import { ActionDialog } from '@/components/data/action-dialog';
import { ResourceTable } from '@/components/data/resource-table';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Button, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { useState } from 'react';
import { get, post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Link {
  id: string;
  guildId: string;
  name: string;
  ownerRobloxId: number;
  ownerName: string | null;
  teamLock: boolean;
  teamRoleId: string | null;
  logChannelId: string | null;
  active: boolean;
  syncedAt: string | null;
  createdAt: string;
  grantedPeople: number;
  serversOnline: number;
}
interface Detail {
  link: Link;
  rightRoles: Array<{ right: string; discordRoleId: string }>;
  grants: Array<{
    discordUserId: string;
    robloxUserId: number;
    username: string | null;
    right: string;
    grantedAt: string;
  }>;
  servers: Array<{
    server: { id: string; jobId: string };
    players: Array<{ userId: number; username: string; team?: string }>;
  }>;
}

function DetailDialog({ link }: { link: Link }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['private-server', link.id],
    queryFn: () => get<Detail>(`/private-servers/${link.id}`),
    enabled: open,
  });
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Details
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={link.name}>
        {q.isLoading ? (
          <Skeleton />
        ) : q.error ? (
          <ErrorState error={q.error} />
        ) : (
          <div className="space-y-4 text-sm">
            <section>
              <h3 className="mb-1 font-semibold">Spielrechte ↔ Discord-Rollen</h3>
              {q.data!.rightRoles.length ? (
                <ul>
                  {q.data!.rightRoles.map((r) => (
                    <li key={r.right}>
                      <strong>{r.right}</strong> <span className="text-muted">Rolle {r.discordRoleId}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">Noch keine Rolle zugeordnet (im Privatserver-Discord: /ps spielrecht).</p>
              )}
            </section>
            <section>
              <h3 className="mb-1 font-semibold">Vergebene Spielrechte ({q.data!.grants.length})</h3>
              <ul className="max-h-48 overflow-auto">
                {q.data!.grants.map((g) => (
                  <li key={`${g.discordUserId}-${g.right}`}>
                    {g.username ?? g.robloxUserId} → <strong>{g.right}</strong>
                    <span className="text-muted"> · Discord {g.discordUserId}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="mb-1 font-semibold">Laufende Privatserver</h3>
              {q.data!.servers.length ? (
                q.data!.servers.map((s) => (
                  <p key={s.server.id}>
                    <span className="font-mono">{s.server.jobId.slice(0, 8)}</span> · {s.players.length} Spieler:{' '}
                    {s.players.map((p) => `${p.username} (${p.team ?? 'ohne Team'})`).join(', ')}
                  </p>
                ))
              ) : (
                <p className="text-muted">Gerade läuft keiner.</p>
              )}
            </section>
          </div>
        )}
      </Dialog>
    </>
  );
}

/**
 * Privatserver-Discords: Partner-Communities steuern nur die Privatserver ihres Besitzers und vergeben dort
 * Spielrechte über eigene Rollen. Verknüpfen und Entfernen geht nur hier bzw. mit /privatserver im Haupt-Discord.
 */
export default function PrivateServersPage() {
  const can = useCan();
  const invalidate = [['list', '/private-servers']];
  return (
    <>
      <PageHeader
        title="Privatserver-Discords"
        description="Partner-Discords, die nur die Privatserver ihres Besitzers steuern und dort Spielrechte über eigene Rollen vergeben. Im Privatserver-Discord gibt es dafür /ps."
        actions={
          can('private_servers:edit') ? (
            <ActionDialog
              title="Privatserver-Discord verknüpfen"
              description="Der Bot muss Mitglied dieses Discords sein. /ps erscheint dort innerhalb einer Minute."
              submitLabel="Verknüpfen"
              requireReason
              fields={[
                { name: 'guildId', label: 'Discord-Server-ID', required: true },
                { name: 'name', label: 'Anzeigename', required: true },
                {
                  name: 'owner',
                  label: 'Besitzer der Privatserver (Roblox-Name oder -ID)',
                  required: true,
                  hint: 'Namen kennt die Plattform nur von Spielern, die schon im Spiel waren.',
                },
              ]}
              onSubmit={(v) => {
                const owner = String(v.owner);
                return post('/private-servers', {
                  link: {
                    guildId: v.guildId,
                    name: v.name,
                    ...(/^\d+$/.test(owner) ? { ownerRobloxId: Number(owner) } : { ownerUsername: owner }),
                  },
                  reason: v.reason,
                });
              }}
              invalidate={invalidate}
              trigger={(open) => (
                <Button variant="primary" onClick={open}>
                  Verknüpfen
                </Button>
              )}
            />
          ) : undefined
        }
      />
      <ResourceTable<Link>
        path="/private-servers"
        searchable={false}
        rowKey={(l) => l.id}
        filters={[
          {
            name: 'all',
            label: 'Anzeige',
            options: [
              { value: 'false', label: 'Aktive' },
              { value: 'true', label: 'Auch entfernte' },
            ],
          },
        ]}
        emptyTitle="Keine Privatserver-Discords"
        emptyText="Verknüpfe einen Partner-Discord mit dem Roblox-Besitzer seiner Privatserver."
        columns={[
          {
            key: 'n',
            header: 'Name',
            render: (l) => (
              <span>
                <strong>{l.name}</strong>
                <span className="block text-muted">Discord {l.guildId}</span>
              </span>
            ),
          },
          { key: 'o', header: 'Besitzer', render: (l) => `${l.ownerName ?? '–'} (${l.ownerRobloxId})` },
          {
            key: 't',
            header: 'Teamsperre',
            render: (l) => <Badge tone={l.teamLock ? 'warn' : 'muted'}>{l.teamLock ? 'an' : 'aus'}</Badge>,
          },
          { key: 'g', header: 'Mit Spielrecht', render: (l) => l.grantedPeople, sortValue: (l) => l.grantedPeople },
          { key: 's', header: 'Server online', render: (l) => l.serversOnline, sortValue: (l) => l.serversOnline },
          { key: 'y', header: 'Letzter Abgleich', render: (l) => (l.syncedAt ? fmtDateTime(l.syncedAt) : '–') },
          {
            key: 'a',
            header: '',
            render: (l) =>
              l.active ? (
                <span className="flex gap-2">
                  <DetailDialog link={l} />
                  {can('private_servers:edit') && (
                    <ActionDialog
                      title={`${l.name} entfernen`}
                      description="Alle Spielrechte, die dieser Discord vergeben hat, entfallen sofort; /ps verschwindet dort."
                      submitLabel="Entfernen"
                      danger
                      requireReason
                      fields={[]}
                      onSubmit={(v) => post(`/private-servers/${l.id}/unlink`, { reason: v.reason })}
                      invalidate={invalidate}
                      trigger={(open) => (
                        <Button size="sm" onClick={open}>
                          Entfernen
                        </Button>
                      )}
                    />
                  )}
                </span>
              ) : (
                <Badge tone="muted">entfernt</Badge>
              ),
          },
        ]}
      />
    </>
  );
}
