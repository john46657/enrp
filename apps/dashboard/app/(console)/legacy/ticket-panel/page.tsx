'use client';

import { useState } from 'react';
import { ActionDialog } from '@/components/data/action-dialog';
import { LegacyState, SettingsForm, TABLE, type SettingField } from '@/components/data/legacy';
import { Badge, Button, EmptyState, PageHeader, Panel, Select } from '@/components/ui/primitives';
import { fmtMillis, legacyAction, legacyKey, useLegacyGuild, useLegacyLive, type LegacyGuild } from '@/lib/legacy';
import { useCan } from '@/lib/session';

interface TicketType {
  id: string;
  label: string;
  emoji?: string;
  enabled?: boolean;
  capacity: number;
}
interface OpenTicket {
  channelId: string;
  channel: string | null;
  number: number;
  type: string;
  owner: string;
  ownerName: string | null;
  claimedBy: string | null;
  claimedByName: string | null;
  openedAt: number;
}

const LEAVE = [
  { value: 'nothing', label: 'Nichts' },
  { value: 'notify', label: 'Hinweis im Ticket' },
  { value: 'close', label: 'Ticket schließen' },
];

const PANEL: SettingField[] = [
  { path: 'tickets.panel.title', label: 'Überschrift', type: 'text', maxLength: 200 },
  { path: 'tickets.panel.placeholder', label: 'Text im Auswahlmenü', type: 'text', maxLength: 150 },
  { path: 'tickets.panel.description', label: 'Beschreibung', type: 'textarea', maxLength: 1500 },
  { path: 'tickets.panel.image', label: 'Banner (Bild-URL)', type: 'text', hint: 'https://… – leer = kein Banner.' },
  { path: 'tickets.panel.footer', label: 'Fußzeile', type: 'text', maxLength: 200 },
  { path: 'tickets.panel.showLoad', label: 'Auslastung im Panel anzeigen', type: 'bool' },
];
const BEHAVIOR: SettingField[] = [
  { path: 'tickets.categoryId', label: 'Discord-Kategorie für neue Tickets', type: 'category' },
  {
    path: 'tickets.maxOpenPerUser',
    label: 'Offene Tickets pro Nutzer',
    type: 'number',
    min: 0,
    max: 50,
    hint: '0 = kein Limit.',
  },
  {
    path: 'tickets.channelName',
    label: 'Kanalname',
    type: 'text',
    maxLength: 90,
    hint: 'Platzhalter: %PREFIX% %USERNAME% %USER_ID% %USER_NICK_NAME% %DISPLAY_NAME% %EMOTE% %TICKET_NUMBER% %CASEID%',
    wide: true,
  },
  { path: 'tickets.pingTeam', label: 'Team beim Öffnen markieren', type: 'bool' },
  {
    path: 'tickets.onlyTeamCanClose',
    label: 'Nur das Team darf schließen',
    type: 'bool',
    hint: 'Ersteller können dann nur um Schließung bitten.',
  },
  { path: 'tickets.creatorCanAddUsers', label: 'Ersteller dürfen Personen anfragen', type: 'bool' },
  { path: 'tickets.logging.activities', label: 'Aktivitäten in den Ticket-Log schreiben', type: 'bool' },
  { path: 'tickets.logging.transcripts', label: 'Verlauf beim Schließen speichern (Transkript)', type: 'bool' },
  { path: 'tickets.onCreatorLeave', label: 'Wenn der Ersteller den Server verlässt', type: 'select', options: LEAVE },
  {
    path: 'tickets.leaveMessage',
    label: 'Hinweis/Grund beim Verlassen',
    type: 'text',
    maxLength: 500,
    hint: 'Platzhalter: {user} {username}',
  },
];
const AUTOMATION: SettingField[] = [
  { path: 'tickets.claimCategory.enabled', label: 'Übernommene Tickets verschieben', type: 'bool' },
  { path: 'tickets.claimCategory.categoryId', label: 'Kategorie für übernommene Tickets', type: 'category' },
  { path: 'tickets.autoTeamAlert.enabled', label: 'Team erinnern, wenn niemand antwortet', type: 'bool' },
  {
    path: 'tickets.autoTeamAlert.afterMinutes',
    label: 'Erinnerung nach (Minuten)',
    type: 'number',
    min: 1,
    max: 10080,
  },
  {
    path: 'tickets.autoTeamAlert.message',
    label: 'Text der Erinnerung',
    type: 'text',
    maxLength: 500,
    hint: 'Leer = Standard. Platzhalter: {user} {since}',
    wide: true,
  },
  { path: 'tickets.autoUnclaim.enabled', label: 'Ticket freigeben, wenn der Bearbeiter nichts schreibt', type: 'bool' },
  { path: 'tickets.autoUnclaim.afterHours', label: 'Freigeben nach (Stunden)', type: 'number', min: 1, max: 720 },
  { path: 'tickets.autoClose.enabled', label: 'Ticket schließen, wenn niemand mehr schreibt', type: 'bool' },
  { path: 'tickets.autoClose.afterHours', label: 'Schließen nach (Stunden)', type: 'number', min: 1, max: 2160 },
];
const HOURS: SettingField[] = [
  {
    path: 'tickets.openingHours.enabled',
    label: 'Öffnungszeiten verwenden',
    type: 'bool',
    hint: 'Außerhalb bekommt jedes neue Ticket einen Hinweis, Erinnerungen pausieren.',
  },
  { path: 'tickets.openingHours.timezone', label: 'Zeitzone', type: 'text', hint: 'z. B. Europe/Berlin' },
  {
    path: 'tickets.openingHours.periods',
    label: 'Zeiten',
    type: 'periods',
    hint: 'Format: mo-fr 15:00-23:00; sa,so 12:00-24:00 (auch über Mitternacht, 24:00 = Tagesende)',
  },
];

const typeFields = (id: string): SettingField[] => {
  const p = `tickets.types.${id}`;
  return [
    { path: `${p}.enabled`, label: 'Im Panel anbieten', type: 'bool' },
    { path: `${p}.allowClaim`, label: 'Tickets dürfen übernommen werden', type: 'bool' },
    { path: `${p}.allowOnBehalf`, label: 'Team darf Tickets im Auftrag öffnen (/ticket fuer)', type: 'bool' },
    {
      path: `${p}.capacity`,
      label: 'Kapazität (für die Auslastung)',
      type: 'number',
      min: 0,
      max: 1000,
      hint: '0 = Auslastung ausblenden.',
    },
    { path: `${p}.label`, label: 'Name', type: 'text', maxLength: 80 },
    { path: `${p}.emoji`, label: 'Emoji', type: 'text', maxLength: 40 },
    { path: `${p}.description`, label: 'Text im Panel', type: 'textarea', maxLength: 500 },
    { path: `${p}.roles`, label: 'Team-Rollen', type: 'roles', hint: 'Leer = die allgemeine Support-Rolle.' },
    {
      path: `${p}.categoryId`,
      label: 'Eigene Discord-Kategorie',
      type: 'category',
      hint: 'Leer = die allgemeine Ticket-Kategorie.',
    },
    {
      path: `${p}.openEmbed.title`,
      label: 'Eröffnungs-Embed: Titel',
      type: 'text',
      maxLength: 200,
      hint: 'Leer = Standard.',
    },
    {
      path: `${p}.openEmbed.description`,
      label: 'Eröffnungs-Embed: Text',
      type: 'textarea',
      maxLength: 1500,
      hint: 'Platzhalter: {user} {username} {category} {number}',
    },
    { path: `${p}.openEmbed.image`, label: 'Eröffnungs-Embed: Bild-URL', type: 'text' },
  ];
};

function Types({ guild, canEdit }: { guild: LegacyGuild; canEdit: boolean }) {
  const types = ((guild.config.tickets as { types?: TicketType[] })?.types ?? []) as TicketType[];
  const [selected, setSelected] = useState(types[0]?.id ?? '');
  const current = types.find((t) => t.id === selected) ?? types[0];
  if (!current) return null;
  return (
    <SettingsForm
      key={current.id}
      title={`Kategorie: ${current.emoji ?? ''} ${current.label}`}
      description="Neue Kategorien legst du weiterhin in der config.json der Altmodule an."
      guild={guild}
      fields={typeFields(current.id)}
      canEdit={canEdit}
      actions={
        <Select aria-label="Kategorie wählen" value={current.id} onChange={(e) => setSelected(e.target.value)}>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
              {t.enabled === false ? ' (aus)' : ''}
            </option>
          ))}
        </Select>
      }
    />
  );
}

export default function TicketPanelPage() {
  const can = useCan();
  const q = useLegacyGuild();
  const open = useLegacyLive<OpenTicket[]>('tickets', { enabled: can('tickets:view'), refetchInterval: 60_000 });
  const edit = can('settings:edit');
  const textChannels = (q.data?.channels ?? []).filter((c) => c.type === 0 || c.type === 5);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Ticketpanel"
        description="Das Panel, über das Mitglieder in Discord Tickets öffnen: Aussehen, Kategorien, Verhalten und Öffnungszeiten. Geschlossene Tickets und Verläufe findest du unter Tickets."
        actions={
          edit &&
          q.data && (
            <>
              <ActionDialog
                title="Ticketpanel posten"
                description="Postet das Panel in den gewählten Kanal. Die Auslastung aktualisiert sich automatisch."
                fields={[
                  {
                    name: 'channelId',
                    label: 'Kanal',
                    type: 'select',
                    required: true,
                    options: textChannels.map((c) => ({ value: c.id, label: `# ${c.name}` })),
                  },
                ]}
                submitLabel="Posten"
                successMessage="Ticketpanel gepostet."
                onSubmit={(v) => legacyAction('ticket-panel-post', v)}
                invalidate={[legacyKey('guild')]}
                trigger={(o) => (
                  <Button variant="primary" onClick={o}>
                    Panel posten
                  </Button>
                )}
              />
              <ActionDialog
                title="Gepostete Panels aktualisieren"
                description="Zeichnet alle geposteten Ticketpanels neu (Texte, Kategorien, Auslastung)."
                fields={[]}
                submitLabel="Aktualisieren"
                successMessage="Panels aktualisiert."
                onSubmit={() => legacyAction('ticket-panels-refresh')}
                invalidate={[legacyKey('guild')]}
                trigger={(o) => <Button onClick={o}>Panels aktualisieren</Button>}
              />
            </>
          )
        }
      />
      {can('tickets:view') && (
        <Panel title="Offene Tickets aus dem Panel">
          <LegacyState query={open}>
            {!open.data?.length ? (
              <EmptyState title="Keine offenen Tickets" />
            ) : (
              <div className="overflow-x-auto">
                <table className={TABLE}>
                  <thead>
                    <tr>
                      <th>Nr.</th>
                      <th>Kanal</th>
                      <th>Kategorie</th>
                      <th>Ersteller</th>
                      <th>Bearbeiter</th>
                      <th>Geöffnet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {open.data.map((t) => (
                      <tr key={t.channelId}>
                        <td>#{t.number}</td>
                        <td>{t.channel ?? t.channelId}</td>
                        <td>{t.type}</td>
                        <td>{t.ownerName ?? t.owner}</td>
                        <td>{t.claimedBy ? (t.claimedByName ?? t.claimedBy) : <Badge tone="warn">offen</Badge>}</td>
                        <td>{fmtMillis(t.openedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </LegacyState>
        </Panel>
      )}
      <LegacyState query={q}>
        {q.data && (
          <>
            <SettingsForm title="Aussehen des Panels" guild={q.data} fields={PANEL} canEdit={edit} />
            <Types guild={q.data} canEdit={edit} />
            <SettingsForm title="Verhalten" guild={q.data} fields={BEHAVIOR} canEdit={edit} />
            <SettingsForm title="Automatik" guild={q.data} fields={AUTOMATION} canEdit={edit} />
            <SettingsForm title="Öffnungszeiten" guild={q.data} fields={HOURS} canEdit={edit} />
          </>
        )}
      </LegacyState>
    </div>
  );
}
