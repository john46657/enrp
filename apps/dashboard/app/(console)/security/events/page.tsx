'use client';

import { useQuery } from '@tanstack/react-query';
import { ActionDialog } from '@/components/data/action-dialog';
import { Badge, Button, ErrorState, PageHeader, Panel, Skeleton } from '@/components/ui/primitives';
import { get, post } from '@/lib/api';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { useCan, useSession } from '@/lib/session';

const TYPES: Record<string, string> = {
  'auth.invalid_service_token': 'Ungültiges Service-Token',
  'auth.csrf_failed': 'CSRF-Prüfung fehlgeschlagen',
  'auth.login_denied': 'Anmeldung ohne Berechtigung',
  'auth.oauth_state_invalid': 'Ungültiger OAuth-Zustand',
  'verification.discord_mismatch': 'Verifizierung mit fremdem Discord-Konto',
  'verification.state_invalid': 'Ungültiger Verifizierungslink',
  'roblox.replay_detected': 'Roblox: wiederholte Anfrage (Replay)',
  'roblox.unauthenticated': 'Roblox: ungültiger Schlüssel',
  'roblox.invalid_signature': 'Roblox: Zeitstempel/Nonce ungültig',
  'roblox.forbidden': 'Roblox: Place nicht freigegeben',
};

export default function SecurityEventsPage() {
  const can = useCan();
  const me = useSession();
  const events = useQuery({
    queryKey: ['security-events'],
    queryFn: () =>
      get<{
        items: Array<{
          id: string;
          occurredAt: string;
          type: string;
          severity: string;
          actorId: string | null;
          ipHash: string | null;
          details: unknown;
        }>;
        summary: Array<{ type: string; c: number }>;
      }>('/security/events'),
  });
  const sessions = useQuery({
    queryKey: ['admin-sessions'],
    queryFn: () =>
      get<{
        items: Array<{
          id: string;
          discordUserId: string;
          createdAt: string;
          lastSeenAt: string;
          expiresAt: string;
          userAgent: string | null;
        }>;
      }>('/security/sessions'),
  });
  if (events.isLoading) return <Skeleton />;
  if (events.error) return <ErrorState error={events.error} />;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Sicherheitsereignisse & Sitzungen"
        description="IP-Adressen werden nur als nicht umkehrbarer Hash gespeichert. Tokens und Geheimnisse werden nie protokolliert."
      />
      <Panel title="Letzte 24 Stunden">
        {events.data!.summary.length ? (
          <ul className="flex flex-wrap gap-3 text-sm">
            {events.data!.summary.map((s) => (
              <li key={s.type} className="rounded-md border border-line px-3 py-1.5">
                <span className="tabular font-semibold">{s.c}</span> {TYPES[s.type] ?? s.type}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Keine Sicherheitsereignisse.</p>
        )}
      </Panel>
      <Panel title="Aktive Dashboard-Sitzungen">
        <ul className="divide-y divide-line text-sm">
          {sessions.data?.items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className="font-medium">{s.discordUserId}</span>
              {s.discordUserId === me.user.id && <Badge tone="info">du</Badge>}
              <span className="text-muted">
                aktiv {fmtRelative(s.lastSeenAt)}, angemeldet {fmtDateTime(s.createdAt)}
              </span>
              <span className="max-w-xs truncate text-xs text-muted">{s.userAgent}</span>
              {(can('security:edit') || s.discordUserId === me.user.id) && (
                <ActionDialog
                  title="Sitzung beenden"
                  submitLabel="Beenden"
                  danger
                  requireReason
                  fields={[]}
                  onSubmit={(v) => post(`/security/sessions/${s.id}/revoke`, v)}
                  invalidate={[['admin-sessions']]}
                  trigger={(open) => (
                    <Button size="sm" variant="ghost" className="ml-auto" onClick={open}>
                      Beenden
                    </Button>
                  )}
                />
              )}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Ereignisse">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1.5 font-medium">Zeitpunkt</th>
                <th className="font-medium">Ereignis</th>
                <th className="font-medium">Schwere</th>
                <th className="font-medium">Akteur</th>
                <th className="font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {events.data!.items.map((e) => (
                <tr key={e.id}>
                  <td className="py-1.5 whitespace-nowrap">{fmtDateTime(e.occurredAt)}</td>
                  <td>{TYPES[e.type] ?? e.type}</td>
                  <td>
                    <Badge tone={e.severity === 'critical' ? 'bad' : e.severity === 'warning' ? 'warn' : 'muted'}>
                      {e.severity}
                    </Badge>
                  </td>
                  <td>{e.actorId ?? '–'}</td>
                  <td className="max-w-sm truncate font-mono text-xs text-muted">
                    {e.details ? JSON.stringify(e.details) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
