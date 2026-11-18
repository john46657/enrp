'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ActionDialog } from '@/components/data/action-dialog';
import { LegacyState, SettingsForm, type SettingField } from '@/components/data/legacy';
import { Badge, Button, KeyValues, PageHeader, Panel } from '@/components/ui/primitives';
import { resetLegacySettings, useLegacyGuild } from '@/lib/legacy';
import { useCan } from '@/lib/session';

const CHANNELS: SettingField[] = [
  { path: 'channels.welcome', label: 'Willkommen', type: 'channel', hint: 'Nur für die bisherige Begrüßung.' },
  { path: 'channels.modLog', label: 'Mod-Log', type: 'channel', hint: 'Sperren, gelöschte Bewerbungen, /clear.' },
  { path: 'channels.ticketLog', label: 'Ticket-Log', type: 'channel', hint: 'Aktivitäten und Transkripte.' },
  { path: 'channels.levelUp', label: 'Level-Up', type: 'channel', hint: 'Leer = im Kanal der Nachricht.' },
];
const ROLES: SettingField[] = [
  { path: 'roles.autoRole', label: 'Auto-Rolle', type: 'role', hint: 'Bekommt jedes neue Mitglied.' },
  { path: 'roles.support', label: 'Support', type: 'role', hint: 'Standard-Team für Tickets.' },
  {
    path: 'roles.staff',
    label: 'Staff',
    type: 'role',
    hint: 'Darf alle Bewerbungen entscheiden und Tickets freigeben.',
  },
];
const GENERAL: SettingField[] = [
  {
    path: 'timezone',
    label: 'Zeitzone',
    type: 'text',
    hint: 'IANA-Name, z. B. Europe/Berlin. Für Transkripte und die Bewerbungsstatistik.',
  },
  {
    path: 'roblox.game',
    label: 'Roblox-Spiel (Place-ID)',
    type: 'text',
    hint: 'Nur die Zahl aus dem Spiel-Link. Leer = kein Spiel.',
  },
  {
    path: 'welcome.message',
    label: 'Willkommensnachricht (bisherige Begrüßung)',
    type: 'textarea',
    maxLength: 1500,
    hint: 'Platzhalter: {user} {name} {server} {count}. Gilt nur, wenn die Begrüßung unter Community-Tools aus ist.',
  },
];

export default function LegacySettingsPage() {
  const can = useCan();
  const client = useQueryClient();
  const q = useLegacyGuild();
  const edit = can('settings:edit');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Einstellungen der Altmodule"
        description="Kanäle, Rollen und Texte für Bewerbungen, Ticketpanel und Level – dieselben Werte wie /einstellungen in Discord. Änderungen gelten sofort."
      />
      <LegacyState query={q}>
        {q.data && (
          <>
            <Panel
              title={
                <span className="flex items-center gap-2">
                  {q.data.guild.name}
                  <Badge tone={q.data.changed ? 'info' : 'muted'}>
                    {q.data.changed ? `${q.data.changed} Abweichung(en) von der config.json` : 'Vorlage (config.json)'}
                  </Badge>
                </span>
              }
              actions={
                can('settings:configure') && (
                  <ActionDialog
                    title="Alle Einstellungen zurücksetzen"
                    description="Verwirft alle Änderungen aus Discord und dem Dashboard für diesen Server – auch Ticket-Kategorien und Bewerbungsarten. Danach gilt wieder die config.json der Altmodule."
                    fields={[]}
                    danger
                    confirmWord="ZURÜCKSETZEN"
                    submitLabel="Zurücksetzen"
                    onSubmit={() => resetLegacySettings()}
                    onDone={() => client.invalidateQueries({ queryKey: ['legacy'] })}
                    trigger={(open) => (
                      <Button variant="danger" onClick={open}>
                        Zurücksetzen
                      </Button>
                    )}
                  />
                )
              }
            >
              <KeyValues
                items={[
                  ['Server-ID', q.data.guild.id],
                  ['Mitglieder', q.data.guild.memberCount.toLocaleString('de-DE')],
                  ['Gepostete Ticketpanels', String(q.data.ticketPanels)],
                ]}
              />
            </Panel>
            <SettingsForm title="Kanäle" guild={q.data} fields={CHANNELS} canEdit={edit} />
            <SettingsForm title="Rollen" guild={q.data} fields={ROLES} canEdit={edit} />
            <SettingsForm title="Allgemein" guild={q.data} fields={GENERAL} canEdit={edit} />
          </>
        )}
      </LegacyState>
    </div>
  );
}
