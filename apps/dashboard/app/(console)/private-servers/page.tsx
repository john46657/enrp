'use client';

import { useQuery } from '@tanstack/react-query';
import { ActionDialog } from '@/components/data/action-dialog';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  KeyValues,
  PageHeader,
  Panel,
  Skeleton,
} from '@/components/ui/primitives';
import { get, put } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

interface PrivateServer {
  id: string;
  privateServerId: string;
  ownerRobloxId: number;
  ownerName: string | null;
  name: string | null;
  teamLock: boolean;
  teamFactions: Record<string, string>;
  admins: number[];
  adminList: Array<{ robloxUserId: number; username: string | null }>;
  online: { jobId: string; playerCount: number; maxPlayers: number | null } | null;
  lastSeenAt: string;
  isOwner: boolean;
}

/** „Polizei = polizei“ je Zeile ↔ { Polizei: 'polizei' } */
const mappingToText = (m: Record<string, string>) =>
  Object.entries(m)
    .map(([team, faction]) => `${team} = ${faction}`)
    .join('\n');
function textToMapping(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const [team, faction] = line.split('=').map((s) => s?.trim());
    if (!team) continue;
    if (!faction) throw new Error(`Zeile „${team}“: Fraktion fehlt (Format: Team = fraktion)`);
    out[team] = faction;
  }
  return out;
}
function textToIds(text: string): number[] {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  const ids = parts.map((p) => Number(p));
  const bad = parts.filter((_, i) => !Number.isInteger(ids[i]) || ids[i]! <= 0);
  if (bad.length) throw new Error(`Keine gültige Roblox-ID: ${bad.join(', ')}`);
  return ids;
}

export default function PrivateServersPage() {
  const can = useCan();
  const q = useQuery({
    queryKey: ['private-servers'],
    queryFn: () => get<{ items: PrivateServer[]; canViewAll: boolean }>('/private-servers'),
  });
  const factions = useQuery({
    queryKey: ['factions-public'],
    queryFn: () => get<{ items: Array<{ key: string; name: string }> }>('/factions'),
  });
  if (q.isLoading) return <Skeleton />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { items, canViewAll } = q.data!;
  const factionHint = factions.data?.items.length
    ? `Fraktionen: ${factions.data.items.map((f) => f.key).join(', ')}`
    : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Privat-Server"
        description={
          canViewAll
            ? 'Alle Privat-Server des Spiels. Besitzer und ihre Admins haben Team-Befehle nur auf ihrem eigenen Privat-Server – im Hauptspiel nie.'
            : 'Deine Privat-Server (über dein verknüpftes Roblox-Konto). Du und deine Admins könnt dort Team-Befehle (:kick, :jail …) nutzen – im Hauptspiel nicht.'
        }
      />
      {!items.length ? (
        <EmptyState title="Keine Privat-Server gefunden">
          Ein Privat-Server erscheint hier, sobald er einmal gestartet wurde. Dein Roblox-Konto muss mit Discord
          verknüpft sein (/verify).
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {items.map((s) => {
            const manage = s.isOwner || can('roblox_servers:configure');
            return (
              <Panel
                key={s.id}
                title={
                  <span className="flex items-center gap-2">
                    {s.name ?? `Privat-Server von ${s.ownerName ?? s.ownerRobloxId}`}
                    {s.online ? <Badge tone="ok">online</Badge> : <Badge>offline</Badge>}
                    {s.isOwner && <Badge tone="info">deiner</Badge>}
                  </span>
                }
                actions={
                  manage && (
                    <ActionDialog
                      title="Privat-Server einstellen"
                      submitLabel="Speichern"
                      description="Die Teamsperre ist eine Extra-Funktion nur für Privat-Server und standardmäßig aus. Im Hauptspiel darf jeder in jedes Team; gezählter Dienst bleibt Fraktionsmitgliedern vorbehalten."
                      fields={[
                        {
                          name: 'name',
                          label: 'Name',
                          defaultValue: s.name ?? '',
                          placeholder: 'z. B. Mein RP-Server',
                        },
                        {
                          name: 'teamLock',
                          label: 'Teamsperre an (Teams nur für passende Fraktion)',
                          type: 'checkbox',
                          defaultValue: s.teamLock,
                        },
                        {
                          name: 'teamFactions',
                          label: 'Team → Fraktion (eine Zeile je Team)',
                          type: 'textarea',
                          defaultValue: mappingToText(s.teamFactions),
                          placeholder: 'Polizei = polizei\nFeuerwehr = feuerwehr',
                          hint: `Leer lassen = Standard (Polizei, Feuerwehr, Rettungsdienst). ${factionHint ?? ''}`,
                        },
                        {
                          name: 'admins',
                          label: 'Admins (Roblox-IDs, durch Komma oder Zeilen getrennt)',
                          type: 'textarea',
                          defaultValue: s.admins.join('\n'),
                          hint: 'Höchstens 25. Admins dürfen auf diesem Privat-Server Team-Befehle nutzen.',
                        },
                      ]}
                      onSubmit={(v) => {
                        const mapping = textToMapping(String(v.teamFactions ?? ''));
                        return put(`/private-servers/${s.id}`, {
                          name: v.name ? String(v.name) : null,
                          teamLock: Boolean(v.teamLock),
                          ...(Object.keys(mapping).length || !v.teamLock ? { teamFactions: mapping } : {}),
                          admins: textToIds(String(v.admins ?? '')),
                        });
                      }}
                      invalidate={[['private-servers']]}
                      trigger={(o) => (
                        <Button variant="primary" onClick={o}>
                          Bearbeiten
                        </Button>
                      )}
                    />
                  )
                }
              >
                <KeyValues
                  items={[
                    ['Besitzer', `${s.ownerName ?? 'unbekannt'} (${s.ownerRobloxId})`],
                    [
                      'Status',
                      s.online
                        ? `online · ${s.online.playerCount}${s.online.maxPlayers ? `/${s.online.maxPlayers}` : ''} Spieler`
                        : `zuletzt gesehen ${fmtDateTime(s.lastSeenAt)}`,
                    ],
                    ['Teamsperre', s.teamLock ? 'an' : 'aus (jeder darf in jedes Team)'],
                    [
                      'Team → Fraktion',
                      Object.keys(s.teamFactions).length
                        ? Object.entries(s.teamFactions)
                            .map(([t, f]) => `${t} → ${f}`)
                            .join(', ')
                        : '–',
                    ],
                    [
                      'Admins',
                      s.adminList.length
                        ? s.adminList.map((a) => a.username ?? String(a.robloxUserId)).join(', ')
                        : 'keine',
                    ],
                  ]}
                />
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
