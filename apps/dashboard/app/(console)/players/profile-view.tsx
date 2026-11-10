'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ActionDialog } from '@/components/data/action-dialog';
import { FACTION_OPTIONS } from '@/components/data/options';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  FactionTag,
  KeyValues,
  PageHeader,
  Panel,
  Skeleton,
  StatusBadge,
} from '@/components/ui/primitives';
import { get, post } from '@/lib/api';
import { fmtDate, fmtDateTime, fmtDuration, fmtRelative } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Profile {
  roblox: { id: number; username: string; displayName: string | null; lastSeenAt: string | null } | null;
  verified: boolean;
  verifiedAt: string | null;
  faction: { key: string; name: string; since: string } | null;
  playtimeSeconds: number;
  online: boolean;
  duty: {
    onDuty: { factionKey: string; since: string } | null;
    totalSeconds: number;
    sessions: number;
    weekSeconds: number;
    monthSeconds: number;
    perFaction: Array<{ factionKey: string; factionName: string; seconds: number }>;
  } | null;
  discord: { id: string; username: string; globalName: string | null } | null;
  canViewPrivate: boolean;
  private: {
    moderation: Array<{
      id: string;
      number: number;
      type: string;
      platform: string;
      status: string;
      reason: string;
      createdAt: string;
      expiresAt: string | null;
    }>;
    reports: Array<{ id: string; number: number; status: string; description: string; createdAt: string }>;
    history: Array<{ id: string; summary: string; data: string | null; createdAt: string }>;
    factionHistory: Array<{ factionName: string; joinedAt: string; endedAt: string | null; endReason: string | null }>;
  } | null;
}

export function ProfileView({ path }: { path: string }) {
  const can = useCan();
  const q = useQuery({ queryKey: ['profile', path], queryFn: () => get<Profile>(path) });
  if (q.isLoading) return <Skeleton rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data!;
  const invalidate = [['profile', path]];
  const robloxId = p.roblox?.id;

  return (
    <div className="space-y-6">
      <PageHeader
        title={p.roblox ? (p.roblox.displayName ?? p.roblox.username) : (p.discord?.username ?? 'Spieler')}
        description={p.roblox ? `@${p.roblox.username}, Roblox-ID ${p.roblox.id}` : 'Nur Discord-Konto bekannt'}
        actions={
          <>
            {robloxId && can('factions:edit') && (
              <ActionDialog
                title="Fraktion zuweisen"
                description="Aufnahme oder Versetzung. Ein laufender Dienst in der bisherigen Fraktion wird beendet."
                submitLabel="Zuweisen"
                successMessage="Fraktion zugewiesen"
                requireReason
                fields={[
                  { name: 'faction', label: 'Fraktion', type: 'select', required: true, options: FACTION_OPTIONS },
                ]}
                onSubmit={(v, key) =>
                  post(`/factions/${v.faction}/members`, { robloxUserId: robloxId, reason: v.reason }, key)
                }
                invalidate={invalidate}
                trigger={(open) => <Button onClick={open}>Fraktion zuweisen</Button>}
              />
            )}
            {robloxId && p.faction && can('factions:edit') && (
              <ActionDialog
                title="Aus Fraktion entfernen"
                submitLabel="Entfernen"
                danger
                requireReason
                fields={[]}
                onSubmit={(v, key) =>
                  post('/factions/members/remove', { robloxUserId: robloxId, reason: v.reason }, key)
                }
                invalidate={invalidate}
                trigger={(open) => (
                  <Button variant="danger" onClick={open}>
                    Aus Fraktion entfernen
                  </Button>
                )}
              />
            )}
            {can('moderation:create') && (
              <ActionDialog
                title="Moderationsaktion"
                description="Discord-Aktionen werden sofort ausgeführt. Roblox-Aktionen übernimmt der nächste Spielserver."
                submitLabel="Ausführen"
                danger
                requireReason
                fields={[
                  {
                    name: 'type',
                    label: 'Aktion',
                    type: 'select',
                    required: true,
                    options: [
                      { value: 'warn', label: 'Verwarnung' },
                      { value: 'timeout', label: 'Timeout (Discord)' },
                      { value: 'kick', label: 'Kick' },
                      { value: 'ban', label: 'Bann' },
                      { value: 'note', label: 'Interne Notiz' },
                    ],
                  },
                  {
                    name: 'platform',
                    label: 'Plattform',
                    type: 'select',
                    required: true,
                    options: [
                      { value: 'discord', label: 'Discord' },
                      { value: 'roblox', label: 'Roblox' },
                    ],
                  },
                  {
                    name: 'durationHours',
                    label: 'Dauer in Stunden',
                    type: 'number',
                    min: 0,
                    hint: 'Leer = ohne Ablauf. Permanente Banns erfordern Freigaberecht.',
                  },
                ]}
                onSubmit={(v, key) =>
                  post(
                    '/moderation/actions',
                    {
                      type: v.type,
                      platform: v.platform,
                      reason: v.reason,
                      targetDiscordId: p.discord?.id,
                      targetRobloxId: robloxId,
                      durationSeconds: v.durationHours ? Math.round(Number(v.durationHours) * 3600) : undefined,
                    },
                    key,
                  )
                }
                successMessage={(r) =>
                  `Aktion #${(r as { number: number; status: string }).number} angelegt (${(r as { status: string }).status})`
                }
                invalidate={invalidate}
                trigger={(open) => (
                  <Button variant="danger" onClick={open}>
                    Moderieren
                  </Button>
                )}
              />
            )}
            {p.verified && p.discord && can('verification:delete') && (
              <ActionDialog
                title="Kontoverknüpfung aufheben"
                description="Die Rolle „Verifiziert“ wird entfernt. Die Person kann sich anschließend neu verifizieren."
                submitLabel="Verknüpfung aufheben"
                danger
                requireReason
                fields={[]}
                onSubmit={(v, key) =>
                  post('/verification/unlink', { discordUserId: p.discord!.id, reason: v.reason }, key)
                }
                invalidate={invalidate}
                trigger={(open) => (
                  <Button variant="ghost" onClick={open}>
                    Verknüpfung aufheben
                  </Button>
                )}
              />
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Konto">
          <KeyValues
            items={[
              [
                'Roblox-Name',
                p.roblox ? `${p.roblox.username}${p.roblox.displayName ? ` (${p.roblox.displayName})` : ''}` : '–',
              ],
              ['Roblox-ID', p.roblox?.id],
              [
                'Discord',
                p.discord
                  ? `${p.discord.globalName ?? p.discord.username} (${p.discord.id})`
                  : p.canViewPrivate
                    ? 'nicht verknüpft'
                    : 'nur mit Berechtigung sichtbar',
              ],
              [
                'Verifizierung',
                p.verified ? (
                  <Badge tone="ok">Verifiziert seit {fmtDate(p.verifiedAt)}</Badge>
                ) : (
                  <Badge>Nicht verifiziert</Badge>
                ),
              ],
              [
                'Fraktion',
                p.faction ? (
                  <span>
                    <FactionTag factionKey={p.faction.key} name={p.faction.name} />, seit {fmtDate(p.faction.since)}
                  </span>
                ) : (
                  'keine'
                ),
              ],
              ['Im Spiel', p.online ? <Badge tone="ok">Online</Badge> : `zuletzt ${fmtRelative(p.roblox?.lastSeenAt)}`],
              ['Spielzeit', fmtDuration(p.playtimeSeconds)],
            ]}
          />
        </Panel>
        <Panel title="Dienst">
          {p.duty ? (
            <KeyValues
              items={[
                ['Status', p.duty.onDuty ? `im Dienst seit ${fmtRelative(p.duty.onDuty.since)}` : 'nicht im Dienst'],
                ['Gesamt', `${fmtDuration(p.duty.totalSeconds)} in ${p.duty.sessions} Sessions`],
                ['Letzte 7 Tage', fmtDuration(p.duty.weekSeconds)],
                ['Letzte 30 Tage', fmtDuration(p.duty.monthSeconds)],
                ...p.duty.perFaction.map((f) => [f.factionName, fmtDuration(f.seconds)] as [string, string]),
              ]}
            />
          ) : (
            <p className="text-sm text-muted">Kein Roblox-Konto bekannt.</p>
          )}
          {robloxId && (
            <Link
              href={`/duty?robloxUserId=${robloxId}`}
              className="mt-3 inline-block text-sm text-muted hover:text-text"
            >
              Dienstsessions anzeigen
            </Link>
          )}
        </Panel>
      </div>

      {p.private ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Moderationsvorgänge">
            {p.private.moderation.length ? (
              <ul className="divide-y divide-line text-sm">
                {p.private.moderation.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="tabular text-muted">#{m.number}</span>
                    <span className="font-medium">{m.type}</span>
                    <StatusBadge status={m.status} />
                    <span className="min-w-0 flex-1 truncate">{m.reason}</span>
                    <span className="text-muted">{fmtDate(m.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Keine Moderationsvorgänge" />
            )}
          </Panel>
          <Panel title="Reports über diese Person">
            {p.private.reports.length ? (
              <ul className="divide-y divide-line text-sm">
                {p.private.reports.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 py-2">
                    <Link href={`/reports/${r.id}`} className="tabular hover:underline">
                      #{r.number}
                    </Link>
                    <StatusBadge status={r.status} />
                    <span className="min-w-0 flex-1 truncate">{r.description}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Keine Reports" />
            )}
          </Panel>
          <Panel title="Änderungshistorie">
            <ul className="space-y-1.5 text-sm">
              {p.private.history.map((h) => (
                <li key={h.id}>
                  <span className="text-muted">{fmtDateTime(h.createdAt)}</span> {h.summary}
                  {h.data && <span className="text-muted"> ({h.data})</span>}
                </li>
              ))}
              {!p.private.history.length && <li className="text-muted">Keine Einträge.</li>}
            </ul>
          </Panel>
          <Panel title="Fraktionsverlauf">
            <ul className="space-y-1.5 text-sm">
              {p.private.factionHistory.map((f, i) => (
                <li key={i}>
                  {f.factionName}: {fmtDate(f.joinedAt)} bis {f.endedAt ? fmtDate(f.endedAt) : 'heute'}
                  {f.endReason && <span className="text-muted"> ({f.endReason})</span>}
                </li>
              ))}
              {!p.private.factionHistory.length && <li className="text-muted">Keine Mitgliedschaften.</li>}
            </ul>
          </Panel>
        </div>
      ) : (
        <p className="text-sm text-muted">
          Interne Daten (Moderation, Reports, Historie) sind nur mit der Berechtigung „player_private:view“ sichtbar.
        </p>
      )}
    </div>
  );
}
