'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActionDialog } from '@/components/data/action-dialog';
import { Button, ErrorState, PageHeader, Panel, Skeleton, StatusBadge } from '@/components/ui/primitives';
import { get, post } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';

const subjectFields = [
  { name: 'discordUserId', label: 'Discord-ID' },
  { name: 'robloxUserId', label: 'Roblox-ID', type: 'number' as const },
];

const CATEGORY: Record<string, string> = {
  discordAccount: 'Discord-Konto',
  robloxAccount: 'Roblox-Konto',
  accountLinks: 'Kontoverknüpfungen',
  verifications: 'Verifizierungsprotokoll',
  profileEvents: 'Profilhistorie',
  playSessions: 'Spielsitzungen',
  dutySessions: 'Dienstsessions',
  factionMemberships: 'Fraktionsmitgliedschaften',
  vehicleAssignments: 'Fahrzeugzuweisungen',
  tickets: 'Tickets',
  ticketMessages: 'Nachrichten',
  reportsFiled: 'Erstellte Reports',
  reportsAbout: 'Reports über die Person',
  moderationActions: 'Moderationsvorgänge',
  appeals: 'Einsprüche',
  suggestions: 'Vorschläge',
  votes: 'Abstimmungen',
  giveawayEntries: 'Giveaway-Teilnahmen',
  ruleAcceptances: 'Regelbestätigungen',
  codeRedemptions: 'Code-Einlösungen',
  sessions: 'Dashboard-Sitzungen',
};

export default function PrivacyPage() {
  const can = useCan();
  const [inspection, setInspection] = useState<{
    subject: { discordUserId: string | null; robloxUserId: number | null };
    categories: Record<string, number>;
  } | null>(null);
  const requests = useQuery({
    queryKey: ['privacy-requests'],
    queryFn: () =>
      get<{
        items: Array<{
          id: string;
          number: number;
          type: string;
          status: string;
          subjectDiscordId: string | null;
          subjectRobloxId: number | null;
          reason: string;
          createdAt: string;
          expiresAt: string | null;
          completedAt: string | null;
        }>;
      }>('/privacy/requests'),
  });
  const retention = useQuery({
    queryKey: ['retention'],
    queryFn: () =>
      get<{ items: Array<{ key: string; label: string; days: number; rows: number; cutoff: string }> }>(
        '/privacy/retention',
      ),
  });
  const invalidate = [['privacy-requests']];

  async function downloadExport(id: string) {
    const data = await get<unknown>(`/privacy/exports/${id}`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `datenauskunft-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Datenschutz"
        description="Auskunft, Export und Löschung personenbezogener Daten. Löschungen werden erst nach Vier-Augen-Freigabe ausgeführt; Moderationsdaten bleiben zur Durchsetzung von Sanktionen bis zum Ablauf ihrer Frist erhalten."
        actions={
          <>
            <ActionDialog
              title="Daten einsehen"
              description="Zeigt, in welchen Bereichen Daten zu einer Person gespeichert sind (nur Anzahl)."
              submitLabel="Einsehen"
              fields={subjectFields}
              onSubmit={(v) => post('/privacy/inspect', v)}
              onDone={(r) => setInspection(r as never)}
              successMessage="Übersicht geladen"
              trigger={(open) => <Button onClick={open}>Daten einsehen</Button>}
            />
            {can('privacy:export') && (
              <ActionDialog
                title="Datenauskunft erstellen"
                submitLabel="Erstellen"
                requireReason
                fields={subjectFields}
                onSubmit={(v, k) => post('/privacy/export', v, k)}
                invalidate={invalidate}
                trigger={(open) => <Button onClick={open}>Datenauskunft</Button>}
              />
            )}
            {can('privacy:delete') && (
              <ActionDialog
                title="Löschantrag stellen"
                description="Es wird eine Vorschau erstellt und eine Freigabeanfrage angelegt. Gelöscht wird erst nach Zustimmung einer zweiten Person."
                submitLabel="Löschantrag stellen"
                danger
                requireReason
                fields={subjectFields}
                onSubmit={(v, k) => post('/privacy/deletion', v, k)}
                successMessage={(r) => `Freigabe #${(r as { approval: { number: number } }).approval.number} angelegt`}
                invalidate={invalidate}
                trigger={(open) => (
                  <Button variant="danger" onClick={open}>
                    Löschantrag
                  </Button>
                )}
              />
            )}
          </>
        }
      />
      {inspection && (
        <Panel
          title={`Gespeicherte Daten (Discord ${inspection.subject.discordUserId ?? '–'}, Roblox ${inspection.subject.robloxUserId ?? '–'})`}
        >
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            {Object.entries(inspection.categories).map(([k, v]) => (
              <div key={k} className={`flex justify-between ${v ? '' : 'text-muted'}`}>
                <dt>{CATEGORY[k] ?? k}</dt>
                <dd className="tabular">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      )}
      <Panel title="Anfragen">
        {requests.isLoading ? (
          <Skeleton />
        ) : requests.error ? (
          <ErrorState error={requests.error} />
        ) : (
          <ul className="divide-y divide-line text-sm">
            {requests.data!.items.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="tabular font-medium">#{r.number}</span>
                <span>{r.type === 'export' ? 'Datenauskunft' : 'Löschung'}</span>
                <StatusBadge status={r.status} />
                <span className="text-muted">
                  Discord {r.subjectDiscordId ?? '–'}, Roblox {r.subjectRobloxId ?? '–'}: {r.reason}
                </span>
                <span className="text-muted">{fmtDateTime(r.createdAt)}</span>
                {r.type === 'export' &&
                  r.status === 'completed' &&
                  r.expiresAt &&
                  new Date(r.expiresAt) > new Date() && (
                    <Button size="sm" className="ml-auto" onClick={() => downloadExport(r.id)}>
                      Herunterladen
                    </Button>
                  )}
              </li>
            ))}
            {!requests.data!.items.length && <li className="text-muted">Keine Anfragen.</li>}
          </ul>
        )}
      </Panel>
      <Panel title="Aufbewahrungsfristen und nächste Bereinigung">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-1 font-medium">Bereich</th>
              <th className="font-medium">Frist</th>
              <th className="font-medium">Betroffen bei nächster Bereinigung</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {retention.data?.items.map((r) => (
              <tr key={r.key}>
                <td className="py-1.5">{r.label}</td>
                <td className="tabular">{r.days} Tage</td>
                <td className="tabular">{r.rows}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted">
          Fristen lassen sich unter Konfiguration („Aufbewahrungsfristen“) anpassen. Der Worker bereinigt täglich um
          03:30 UTC.
        </p>
      </Panel>
    </div>
  );
}
