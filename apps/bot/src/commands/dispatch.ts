import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  type SlashCommandIntegerOption,
  type SlashCommandSubcommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { defineCommand } from '../command';
import { describeError } from '../api';
import { embed, reply, trunc, ts, user } from '../ui';

interface Incident {
  id: string;
  number: number;
  source: 'ingame' | 'discord' | 'dashboard';
  title: string;
  description: string;
  location: string;
  priority: number;
  department: string;
  status: string;
  callerName: string | null;
  callerRobloxId: number | null;
  callNumber: number | null;
  report: string | null;
  createdAt: string;
  activeUnits?: number;
}

const STATUS: Record<string, string> = {
  open: '🟥 Offen',
  assigned: '🟧 Zugewiesen',
  en_route: '🟨 Anfahrt',
  on_scene: '🟩 Vor Ort',
  closed: '⬛ Abgeschlossen',
};
const UNIT: Record<string, string> = {
  available: 'Status 2 · Einsatzbereit',
  en_route: 'Status 3 · Anfahrt',
  on_scene: 'Status 4 · Am Einsatzort',
  busy: 'Status 5 · Beschäftigt',
  off_duty: 'Status 6 · Außer Dienst',
};
const PRIO: Record<number, string> = { 1: '🔴 P1', 2: '🟠 P2', 3: '🟢 P3' };

const line = (i: Incident) =>
  `${STATUS[i.status] ?? i.status} **#${i.number}** ${i.source === 'ingame' ? '🎮' : '📝'} ${trunc(i.title, 60)} · ${PRIO[i.priority] ?? ''} · ${i.department} · ${ts(i.createdAt, 'R')}${i.activeUnits ? ` · ${i.activeUnits} Einh.` : ''}`;

const number = (o: SlashCommandIntegerOption) =>
  o.setName('nummer').setDescription('Einsatznummer').setRequired(true).setMinValue(1);

export const cad = defineCommand({
  data: new SlashCommandBuilder()
    .setName('cad')
    .setDescription('Leitstelle: Einsätze und Einheiten')
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('Offene Einsätze (oder alle)')
        .addBooleanOption((o) => o.setName('alle').setDescription('Auch abgeschlossene'))
        .addStringOption((o) => o.setName('suche').setDescription('Text, Ort, Anrufer oder Bericht').setMaxLength(100)),
    )
    .addSubcommand((s) =>
      s.setName('info').setDescription('Einsatz mit Einheiten und Verlauf').addIntegerOption(number),
    )
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Eigenen Einsatz anlegen')
        .addStringOption((o) =>
          o.setName('titel').setDescription('Kurzbeschreibung').setRequired(true).setMaxLength(120),
        )
        .addStringOption((o) => o.setName('ort').setDescription('Einsatzort').setRequired(true).setMaxLength(120))
        .addStringOption((o) => o.setName('beschreibung').setDescription('Details').setMaxLength(2000))
        .addIntegerOption((o) =>
          o
            .setName('prioritaet')
            .setDescription('Priorität')
            .addChoices(
              { name: 'P1 · Hoch', value: 1 },
              { name: 'P2 · Mittel', value: 2 },
              { name: 'P3 · Niedrig', value: 3 },
            ),
        )
        .addStringOption((o) =>
          o.setName('bereich').setDescription('z. B. Polizei, Rettungsdienst, Feuerwehr').setMaxLength(40),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('assign')
        .setDescription('Einheit zuweisen')
        .addIntegerOption(number)
        .addUserOption((o) => o.setName('einheit').setDescription('Person (leer = du selbst)')),
    )
    .addSubcommand((s) =>
      s
        .setName('status')
        .setDescription('Status ändern')
        .addIntegerOption(number)
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Neuer Status')
            .setRequired(true)
            .addChoices(
              { name: 'Offen', value: 'open' },
              { name: 'Zugewiesen', value: 'assigned' },
              { name: 'Anfahrt', value: 'en_route' },
              { name: 'Vor Ort', value: 'on_scene' },
            ),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('note')
        .setDescription('Notiz hinzufügen')
        .addIntegerOption(number)
        .addStringOption((o) => o.setName('text').setDescription('Notiz').setRequired(true).setMaxLength(1000)),
    )
    .addSubcommand((s) =>
      s
        .setName('close')
        .setDescription('Einsatz abschließen')
        .addIntegerOption(number)
        .addStringOption((o) => o.setName('bericht').setDescription('Einsatzbericht').setMaxLength(3000)),
    )
    .addSubcommand((s) =>
      s
        .setName('unit')
        .setDescription('Eigenen Status und Rufnamen setzen')
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Status')
            .setRequired(true)
            .addChoices(...Object.entries(UNIT).map(([value, name]) => ({ name, value }))),
        )
        .addStringOption((o) => o.setName('rufname').setDescription('z. B. Adler 12/1').setMaxLength(20)),
    )
    .addSubcommand((s) =>
      s
        .setName('units')
        .setDescription('Einheiten mit Status')
        .addBooleanOption((o) => o.setName('alle').setDescription('Auch „Außer Dienst“')),
    ),
  async execute(interaction, { api }) {
    const o = interaction.options;
    const sub = o.getSubcommand();
    const nr = () => o.getInteger('nummer', true);
    switch (sub) {
      case 'list': {
        const query = new URLSearchParams({ pageSize: '25' });
        if (!o.getBoolean('alle')) query.set('status', 'open,assigned,en_route,on_scene');
        if (o.getString('suche')) query.set('q', o.getString('suche')!);
        const res = await api.get<{ items: Incident[]; total: number }>(`/api/v1/dispatch/incidents?${query}`);
        return reply(
          interaction,
          embed()
            .setTitle(`🗂️ Einsätze (${res.total})`)
            .setDescription(trunc(res.items.map(line).join('\n') || 'Keine Einsätze.', 4000)),
        );
      }
      case 'info': {
        const d = await api.get<{
          incident: Incident;
          assignments: Array<{ unitId: string; callsign: string | null; releasedAt: string | null }>;
          caller: { name: string | null; online: boolean; team: string | null } | null;
          events: Array<{ type: string; body: string | null; actorId: string | null; createdAt: string }>;
        }>(`/api/v1/dispatch/incidents/${nr()}`);
        const i = d.incident;
        const e = embed(i.status === 'closed' ? 'muted' : 'danger')
          .setTitle(`🚨 Einsatz #${i.number} · ${trunc(i.title, 200)}`)
          .setDescription(
            `${i.source === 'ingame' ? `🎮 Ingame-Notruf${i.callNumber ? ` #${i.callNumber}` : ''}` : '📝 Einsatz der Leitstelle'}\n\n${trunc(i.description || '—', 1500)}`,
          )
          .addFields(
            { name: 'Status', value: STATUS[i.status] ?? i.status, inline: true },
            { name: 'Priorität', value: PRIO[i.priority] ?? String(i.priority), inline: true },
            { name: 'Bereich', value: i.department, inline: true },
            { name: 'Ort', value: i.location || '—', inline: true },
            {
              name: 'Einheiten',
              value:
                d.assignments
                  .filter((a) => !a.releasedAt)
                  .map((a) => (a.callsign ? `**${a.callsign}** (${user(a.unitId)})` : user(a.unitId)))
                  .join('\n') || '—',
              inline: true,
            },
          );
        if (d.caller)
          e.addFields({
            name: 'Anrufer',
            value: `${d.caller.name ?? '—'} · ${d.caller.online ? `🟢 online (${d.caller.team ?? 'ohne Team'})` : '⚫ offline'}`,
          });
        if (i.report) e.addFields({ name: '📄 Einsatzbericht', value: trunc(i.report, 1024) });
        e.addFields({
          name: 'Verlauf',
          value: trunc(
            d.events
              .slice(-10)
              .map(
                (ev) => `${ts(ev.createdAt, 'R')} ${ev.body ?? ev.type}${ev.actorId ? ` – ${user(ev.actorId)}` : ''}`,
              )
              .join('\n') || '—',
            1024,
          ),
        });
        return reply(interaction, e);
      }
      case 'create': {
        const i = await api.post<Incident>(
          '/api/v1/dispatch/incidents',
          {
            title: o.getString('titel', true),
            location: o.getString('ort', true),
            description: o.getString('beschreibung') ?? undefined,
            priority: o.getInteger('prioritaet') ?? undefined,
            department: o.getString('bereich') ?? undefined,
          },
          { idempotencyKey: `cad-${interaction.id}` },
        );
        return reply(
          interaction,
          `✅ Einsatz **#${i.number}** angelegt. Er erscheint im Dispatch-Kanal (sofern eingerichtet).`,
        );
      }
      case 'assign': {
        const unit = o.getUser('einheit');
        const i = await api.post<Incident>(
          `/api/v1/dispatch/incidents/${nr()}/assign`,
          unit ? { unitId: unit.id } : {},
        );
        return reply(interaction, `🚓 ${unit ? user(unit.id) : 'Du bist'} bei Einsatz **#${i.number}** eingeteilt.`);
      }
      case 'status': {
        const i = await api.post<Incident>(`/api/v1/dispatch/incidents/${nr()}/status`, {
          status: o.getString('status', true),
        });
        return reply(interaction, `Status von **#${i.number}**: ${STATUS[i.status] ?? i.status}`);
      }
      case 'note': {
        await api.post(`/api/v1/dispatch/incidents/${nr()}/notes`, { text: o.getString('text', true) });
        return reply(interaction, `📝 Notiz zu Einsatz **#${nr()}** gespeichert.`);
      }
      case 'close': {
        const i = await api.post<Incident>(`/api/v1/dispatch/incidents/${nr()}/close`, {
          report: o.getString('bericht') ?? undefined,
        });
        return reply(interaction, `✅ Einsatz **#${i.number}** abgeschlossen.`);
      }
      case 'unit': {
        const u = await api.put<{ status: string; callsign: string | null }>('/api/v1/dispatch/units/me', {
          status: o.getString('status', true),
          callsign: o.getString('rufname') ?? undefined,
        });
        return reply(interaction, `📻 ${u.callsign ? `**${u.callsign}** · ` : ''}${UNIT[u.status] ?? u.status}`);
      }
      case 'units': {
        const res = await api.get<{
          items: Array<{
            unitId: string;
            callsign: string | null;
            status: string;
            incidentNumber: number | null;
            inGame: { team: string | null } | null;
          }>;
        }>(`/api/v1/dispatch/units?all=${o.getBoolean('alle') ? 'true' : 'false'}`);
        const lines = res.items.map(
          (u) =>
            `${u.callsign ? `**${u.callsign}** (${user(u.unitId)})` : user(u.unitId)} · ${UNIT[u.status] ?? u.status}${u.incidentNumber ? ` · #${u.incidentNumber}` : ''}${u.inGame ? ` · 🎮 ${u.inGame.team ?? 'im Spiel'}` : ''}`,
        );
        return reply(
          interaction,
          embed()
            .setTitle(`📻 Einheiten (${res.items.length})`)
            .setDescription(trunc(lines.join('\n') || 'Niemand im Dienst.', 4000)),
        );
      }
      default:
        return reply(interaction, 'Unbekannter Unterbefehl.');
    }
  },
  components: {
    // Buttons an Einsatznachrichten: cad:take|enroute|onscene|close:<id>, Formular cad:closesubmit:<id>
    async cad(interaction, [action, id], { api }) {
      if (action === 'close' && interaction.isButton()) {
        return interaction.showModal(
          new ModalBuilder()
            .setCustomId(`cad:closesubmit:${id}`)
            .setTitle('Einsatz abschließen')
            .addComponents(
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                  .setCustomId('report')
                  .setLabel('Einsatzbericht')
                  .setStyle(TextInputStyle.Paragraph)
                  .setRequired(false)
                  .setMaxLength(3000),
              ),
            ),
        );
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        if (action === 'take') {
          const i = await api.post<Incident>(`/api/v1/dispatch/incidents/${id}/assign`, {});
          return interaction.editReply(`🚓 Du bist bei Einsatz **#${i.number}** eingeteilt (Status 3 · Anfahrt).`);
        }
        if (action === 'enroute' || action === 'onscene') {
          const i = await api.post<Incident>(`/api/v1/dispatch/incidents/${id}/status`, {
            status: action === 'enroute' ? 'en_route' : 'on_scene',
          });
          return interaction.editReply(`Status von **#${i.number}**: ${STATUS[i.status] ?? i.status}`);
        }
        if (action === 'closesubmit' && interaction.isModalSubmit()) {
          const report = interaction.fields.getTextInputValue('report');
          const i = await api.post<Incident>(`/api/v1/dispatch/incidents/${id}/close`, { report: report || undefined });
          return interaction.editReply(`✅ Einsatz **#${i.number}** abgeschlossen.`);
        }
        return interaction.editReply('Unbekannte Aktion.');
      } catch (err) {
        return interaction.editReply(`❌ ${describeError(err)}`);
      }
    },
    // Buttons an Mod-Calls: mc:claim|close:<id>
    async mc(interaction, [action, id], { api }) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        if (action === 'claim') {
          const c = await api.post<{ number: number }>(`/api/v1/mod-calls/${id}/claim`, {});
          return interaction.editReply(
            `🙋 Mod-Call **#${c.number}** übernommen. Der Spieler wurde im Spiel benachrichtigt.`,
          );
        }
        if (action === 'close') {
          const c = await api.post<{ number: number }>(`/api/v1/mod-calls/${id}/close`, {});
          return interaction.editReply(`✅ Mod-Call **#${c.number}** geschlossen.`);
        }
        return interaction.editReply('Unbekannte Aktion.');
      } catch (err) {
        return interaction.editReply(`❌ ${describeError(err)}`);
      }
    },
  },
});

interface LivePlayer {
  userId: number;
  username: string;
  displayName?: string;
  team?: string;
  wanted: number;
  jailed: boolean;
  callsign?: string;
  server: { jobId: string; serverType: string };
}
interface LiveVehicle {
  model: string;
  plate?: string;
  color?: string;
  ownerId?: number;
  ownerName: string | null;
  server: { jobId: string; serverType: string };
}

const serverLabel = (s: { jobId: string; serverType: string }) =>
  `${s.serverType === 'private' ? '🔒' : s.serverType === 'reserved' ? '🔐' : '🌐'} ${s.jobId.replace(/[^a-z0-9]/gi, '').slice(0, 6)}`;

export const live = defineCommand({
  data: new SlashCommandBuilder()
    .setName('live')
    .setDescription('Live-Lage aus dem Spiel')
    .addSubcommand((s) =>
      s
        .setName('players')
        .setDescription('Spieler online (Team, Fahndung, Gefängnis)')
        .addStringOption((o) => o.setName('suche').setDescription('Name oder ID').setMaxLength(60))
        .addStringOption((o) => o.setName('team').setDescription('Nur dieses Team').setMaxLength(40)),
    )
    .addSubcommand((s) =>
      s
        .setName('vehicles')
        .setDescription('Gespawnte Fahrzeuge')
        .addIntegerOption((o) => o.setName('besitzer').setDescription('Roblox-ID des Besitzers').setMinValue(1)),
    )
    .addSubcommand((s) =>
      s
        .setName('plate')
        .setDescription('Kennzeichen suchen')
        .addStringOption((o) =>
          o.setName('kennzeichen').setDescription('Ganz oder teilweise').setRequired(true).setMaxLength(16),
        ),
    ),
  async execute(interaction, { api }) {
    const o = interaction.options;
    const sub = o.getSubcommand();
    if (sub === 'players') {
      const query = new URLSearchParams();
      if (o.getString('suche')) query.set('q', o.getString('suche')!);
      if (o.getString('team')) query.set('team', o.getString('team')!);
      const res = await api.get<{ items: LivePlayer[] }>(`/api/v1/roblox/live/players?${query}`);
      const lines = res.items.map(
        (p) =>
          `**${p.username}**${p.displayName && p.displayName !== p.username ? ` (${p.displayName})` : ''} · ${p.team ?? 'ohne Team'}${p.callsign ? ` · 📻 ${p.callsign}` : ''}${p.wanted ? ` · ⭐${p.wanted}` : ''}${p.jailed ? ' · 🔒' : ''} · ${serverLabel(p.server)}`,
      );
      return reply(
        interaction,
        embed()
          .setTitle(`👥 Spieler online (${res.items.length})`)
          .setDescription(trunc(lines.join('\n') || 'Niemand online (oder keine Live-Daten).', 4000)),
      );
    }
    const query = new URLSearchParams();
    if (sub === 'plate') query.set('plate', o.getString('kennzeichen', true));
    if (sub === 'vehicles' && o.getInteger('besitzer')) query.set('ownerId', String(o.getInteger('besitzer')));
    const res = await api.get<{ items: LiveVehicle[] }>(`/api/v1/roblox/live/vehicles?${query}`);
    const lines = res.items.map(
      (v) =>
        `🚗 **${v.model}** [${v.plate ?? '—'}]${v.color ? ` · ${v.color}` : ''} · ${v.ownerName ?? (v.ownerId ? String(v.ownerId) : 'ohne Besitzer')} · ${serverLabel(v.server)}`,
    );
    return reply(
      interaction,
      embed()
        .setTitle(
          sub === 'plate'
            ? `🔎 Kennzeichen „${o.getString('kennzeichen', true).toUpperCase()}“ (${res.items.length})`
            : `🚗 Fahrzeuge (${res.items.length})`,
        )
        .setDescription(trunc(lines.join('\n') || 'Nichts gefunden.', 4000)),
    );
  },
});

// ---------------------------------------------------------------------------
// Fahndungen (BOLO)
// ---------------------------------------------------------------------------

interface Bolo {
  id: string;
  number: number;
  kind: 'person' | 'vehicle';
  status: 'active' | 'resolved' | 'expired';
  robloxUserId: number | null;
  personName: string | null;
  plate: string | null;
  vehicleDescription: string | null;
  reason: string;
  priority: number;
  hitCount: number;
  lastHitAt: string | null;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
  resolveNote: string | null;
}

const BOLO_STATUS: Record<string, string> = { active: '🟥 Aktiv', resolved: '✅ Erledigt', expired: '⌛ Abgelaufen' };
const boloTarget = (b: Bolo) =>
  b.kind === 'person'
    ? `👤 ${b.personName ?? b.robloxUserId}`
    : `🚗 ${b.plate}${b.vehicleDescription ? ` (${trunc(b.vehicleDescription, 40)})` : ''}`;
const boloLine = (b: Bolo) =>
  `${BOLO_STATUS[b.status] ?? b.status} **#${b.number}** ${boloTarget(b)} · ${PRIO[b.priority] ?? ''} · ${trunc(b.reason, 60)}${b.hitCount ? ` · 🎯 ${b.hitCount}× (zuletzt ${ts(b.lastHitAt!, 'R')})` : ''}`;

const boloCommon = <T extends SlashCommandSubcommandBuilder>(s: T) =>
  s
    .addStringOption((o) =>
      o.setName('grund').setDescription('Warum wird gefahndet?').setRequired(true).setMaxLength(500),
    )
    .addIntegerOption((o) =>
      o
        .setName('prioritaet')
        .setDescription('Priorität')
        .addChoices({ name: 'Hoch', value: 1 }, { name: 'Mittel', value: 2 }, { name: 'Niedrig', value: 3 }),
    )
    .addIntegerOption((o) =>
      o.setName('stunden').setDescription('Automatisch beenden nach … Stunden').setMinValue(1).setMaxValue(720),
    );

export const bolo = defineCommand({
  data: new SlashCommandBuilder()
    .setName('bolo')
    .setDescription('Fahndungen nach Personen und Kennzeichen (Treffer-Alarm aus dem Spiel)')
    .addSubcommand((s) =>
      boloCommon(
        s
          .setName('person')
          .setDescription('Nach einer Person fahnden')
          .addStringOption((o) =>
            o
              .setName('spieler')
              .setDescription('Roblox-Benutzername oder Roblox-ID')
              .setRequired(true)
              .setMaxLength(20),
          ),
      ),
    )
    .addSubcommand((s) =>
      boloCommon(
        s
          .setName('vehicle')
          .setDescription('Nach einem Kennzeichen fahnden')
          .addStringOption((o) =>
            o.setName('kennzeichen').setDescription('z. B. EN-A1234').setRequired(true).setMaxLength(16),
          )
          .addStringOption((o) =>
            o.setName('fahrzeug').setDescription('Beschreibung, z. B. schwarzer SUV').setMaxLength(120),
          ),
      ),
    )
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('Aktive Fahndungen (oder alle)')
        .addBooleanOption((o) => o.setName('alle').setDescription('Auch erledigte und abgelaufene'))
        .addStringOption((o) => o.setName('suche').setDescription('Name, Kennzeichen oder Grund').setMaxLength(100)),
    )
    .addSubcommand((s) =>
      s
        .setName('info')
        .setDescription('Fahndung mit letztem Treffer')
        .addIntegerOption((o) => o.setName('nummer').setDescription('BOLO-Nummer').setRequired(true).setMinValue(1)),
    )
    .addSubcommand((s) =>
      s
        .setName('resolve')
        .setDescription('Fahndung als erledigt markieren')
        .addIntegerOption((o) => o.setName('nummer').setDescription('BOLO-Nummer').setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName('notiz').setDescription('z. B. festgenommen').setMaxLength(500)),
    ),
  async execute(interaction, { api }) {
    const o = interaction.options;
    const sub = o.getSubcommand();
    const common = {
      reason: o.getString('grund') ?? '',
      priority: o.getInteger('prioritaet') ?? undefined,
      expiresInHours: o.getInteger('stunden') ?? undefined,
    };
    switch (sub) {
      case 'person':
      case 'vehicle': {
        const target = sub === 'person' ? o.getString('spieler', true).trim() : '';
        const body =
          sub === 'person'
            ? {
                kind: 'person',
                ...(/^\d+$/.test(target) ? { robloxUserId: Number(target) } : { username: target }),
                ...common,
              }
            : {
                kind: 'vehicle',
                plate: o.getString('kennzeichen', true),
                vehicleDescription: o.getString('fahrzeug') ?? undefined,
                ...common,
              };
        const b = await api.post<Bolo>('/api/v1/dispatch/bolos', body, { idempotencyKey: `bolo-${interaction.id}` });
        return reply(
          interaction,
          `🔎 Fahndung **#${b.number}** angelegt: ${boloTarget(b)}.${b.hitCount ? ' 🎯 **Sofort-Treffer** – siehe Fahndungskanal.' : ' Treffer im Spiel werden automatisch gemeldet.'}`,
        );
      }
      case 'list': {
        const query = new URLSearchParams({ pageSize: '25' });
        if (!o.getBoolean('alle')) query.set('status', 'active');
        if (o.getString('suche')) query.set('q', o.getString('suche')!);
        const res = await api.get<{ items: Bolo[]; total: number }>(`/api/v1/dispatch/bolos?${query}`);
        return reply(
          interaction,
          embed()
            .setTitle(`🔎 Fahndungen (${res.total})`)
            .setDescription(trunc(res.items.map(boloLine).join('\n') || 'Keine Fahndungen.', 4000)),
        );
      }
      case 'info': {
        const b = await api.get<
          Bolo & {
            lastHit: {
              jobId: string;
              serverType: string;
              player?: { username: string; team: string | null; wanted: number };
              vehicle?: { model: string; plate: string | null; color: string | null };
            } | null;
          }
        >(`/api/v1/dispatch/bolos/${o.getInteger('nummer', true)}`);
        const e = embed(b.status === 'active' ? 'danger' : 'muted')
          .setTitle(`🔎 BOLO #${b.number}`)
          .setDescription(`${boloTarget(b)}\n\n${trunc(b.reason, 1500)}`)
          .addFields(
            { name: 'Status', value: BOLO_STATUS[b.status] ?? b.status, inline: true },
            { name: 'Priorität', value: PRIO[b.priority] ?? String(b.priority), inline: true },
            { name: 'Angelegt', value: `${ts(b.createdAt, 'R')} von ${user(b.createdBy)}`, inline: true },
            { name: 'Treffer', value: String(b.hitCount), inline: true },
          );
        if (b.expiresAt) e.addFields({ name: 'Läuft ab', value: ts(b.expiresAt, 'R'), inline: true });
        if (b.lastHit && b.lastHitAt)
          e.addFields({
            name: 'Letzter Treffer',
            value: [
              `${ts(b.lastHitAt, 'R')} · ${serverLabel(b.lastHit)}`,
              b.lastHit.vehicle
                ? `🚗 ${b.lastHit.vehicle.model} [${b.lastHit.vehicle.plate ?? '—'}]${b.lastHit.vehicle.color ? ` · ${b.lastHit.vehicle.color}` : ''}`
                : null,
              b.lastHit.player
                ? `👤 ${b.lastHit.player.username} · ${b.lastHit.player.team ?? 'ohne Team'}${b.lastHit.player.wanted ? ` · ⭐${b.lastHit.player.wanted}` : ''}`
                : null,
            ]
              .filter(Boolean)
              .join('\n'),
          });
        if (b.resolveNote) e.addFields({ name: 'Notiz', value: trunc(b.resolveNote, 1024) });
        return reply(interaction, e);
      }
      case 'resolve': {
        const b = await api.post<Bolo>(`/api/v1/dispatch/bolos/${o.getInteger('nummer', true)}/resolve`, {
          note: o.getString('notiz') ?? undefined,
        });
        return reply(interaction, `✅ Fahndung **#${b.number}** erledigt.`);
      }
      default:
        return reply(interaction, 'Unbekannter Unterbefehl.');
    }
  },
  components: {
    // Button an Treffermeldungen: bolo:resolve:<id>
    async bolo(interaction, [action, id], { api }) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        if (action === 'resolve') {
          const b = await api.post<Bolo>(`/api/v1/dispatch/bolos/${id}/resolve`, {});
          return interaction.editReply(`✅ Fahndung **#${b.number}** erledigt.`);
        }
        return interaction.editReply('Unbekannte Aktion.');
      } catch (err) {
        return interaction.editReply(`❌ ${describeError(err)}`);
      }
    },
  },
});

// ---------------------------------------------------------------------------
// Ingame-Aktionen an Spielern
// ---------------------------------------------------------------------------

const ACTION_DONE: Record<string, string> = {
  heal: '❤️ Heilen',
  kill: '💀 Töten',
  respawn: '🔄 Respawn',
  jail: '🔒 Gefängnis',
  unjail: '🔓 Entlassen',
  wanted: '⭐ Fahndungsstufe',
  team: '👥 Teamwechsel',
};
const COMMAND_STATUS: Record<string, string> = {
  pending: '⏳ wartet',
  delivered: '📨 zugestellt',
  succeeded: '✅ ausgeführt',
  failed: '❌ fehlgeschlagen',
  expired: '⌛ verfallen',
};

/** Spieler über Name oder ID in der Live-Lage finden (nur wer gerade online ist, kann Ziel einer Aktion sein). */
async function findOnline(api: { get<T>(path: string): Promise<T> }, query: string) {
  const res = await api.get<{ items: LivePlayer[] }>(`/api/v1/roblox/live/players?q=${encodeURIComponent(query)}`);
  const q = query.toLowerCase();
  return (
    res.items.find((p) => String(p.userId) === q || p.username.toLowerCase() === q) ??
    (res.items.length === 1 ? res.items[0] : undefined)
  );
}

const playerOption = <T extends SlashCommandSubcommandBuilder>(s: T) =>
  s.addStringOption((o) =>
    o.setName('spieler').setDescription('Roblox-Name oder -ID (muss online sein)').setRequired(true).setMaxLength(20),
  );
const reasonOption = <T extends SlashCommandSubcommandBuilder>(s: T) =>
  s.addStringOption((o) =>
    o.setName('grund').setDescription('Begründung (Audit-Log)').setRequired(true).setMaxLength(300),
  );

export const ingameCmd = defineCommand({
  data: new SlashCommandBuilder()
    .setName('ingame')
    .setDescription('Aktionen an Spielern im Spiel (Kick/Bann: /mod mit platform roblox)')
    .addSubcommand((s) => reasonOption(playerOption(s.setName('heal').setDescription('Spieler heilen'))))
    .addSubcommand((s) => reasonOption(playerOption(s.setName('respawn').setDescription('Spieler neu spawnen'))))
    .addSubcommand((s) => reasonOption(playerOption(s.setName('kill').setDescription('Spieler töten'))))
    .addSubcommand((s) =>
      reasonOption(
        playerOption(s.setName('jail').setDescription('Ins Gefängnis setzen')).addIntegerOption((o) =>
          o.setName('minuten').setDescription('Dauer').setRequired(true).setMinValue(1).setMaxValue(240),
        ),
      ),
    )
    .addSubcommand((s) => reasonOption(playerOption(s.setName('unjail').setDescription('Aus dem Gefängnis entlassen'))))
    .addSubcommand((s) =>
      reasonOption(
        playerOption(s.setName('wanted').setDescription('Fahndungsstufe setzen')).addIntegerOption((o) =>
          o.setName('stufe').setDescription('0 = keine Fahndung').setRequired(true).setMinValue(0).setMaxValue(5),
        ),
      ),
    )
    .addSubcommand((s) =>
      reasonOption(
        playerOption(s.setName('team').setDescription('Team wechseln')).addStringOption((o) =>
          o.setName('team').setDescription('Name des Teams im Spiel').setRequired(true).setMaxLength(40),
        ),
      ),
    )
    .addSubcommand((s) =>
      s
        .setName('history')
        .setDescription('Letzte Ingame-Aktionen')
        .addStringOption((o) => o.setName('spieler').setDescription('Nur dieser Spieler (Roblox-ID)').setMaxLength(20)),
    ),
  async execute(interaction, { api }) {
    const o = interaction.options;
    const sub = o.getSubcommand();
    if (sub === 'history') {
      const id = o.getString('spieler')?.trim();
      if (id && !/^\d+$/.test(id)) return reply(interaction, 'Bitte die Roblox-ID angeben.');
      const res = await api.get<{
        items: Array<{
          type: string;
          username: string | null;
          robloxUserId: number;
          params: Record<string, unknown> | null;
          reason: string;
          status: string;
          error: string | null;
          createdBy: string;
          createdAt: string;
        }>;
      }>(`/api/v1/roblox/player-actions?limit=20${id ? `&robloxUserId=${id}` : ''}`);
      const lines = res.items.map(
        (a) =>
          `${ts(a.createdAt, 'R')} ${ACTION_DONE[a.type] ?? a.type}${a.params ? ` (${Object.values(a.params).join(', ')})` : ''} · **${a.username ?? a.robloxUserId}** · ${COMMAND_STATUS[a.status] ?? a.status} · ${user(a.createdBy)} · ${trunc(a.reason, 50)}${a.error ? ` · ${trunc(a.error, 60)}` : ''}`,
      );
      return reply(
        interaction,
        embed()
          .setTitle('🎮 Ingame-Aktionen')
          .setDescription(trunc(lines.join('\n') || 'Noch keine Aktionen.', 4000)),
      );
    }
    const query = o.getString('spieler', true).trim();
    const player = await findOnline(api, query);
    if (!player)
      return reply(interaction, `❌ „${query}“ ist gerade nicht im Spiel (oder der Name ist nicht eindeutig).`);
    const command =
      sub === 'jail'
        ? { action: 'jail', minutes: o.getInteger('minuten', true) }
        : sub === 'wanted'
          ? { action: 'wanted', level: o.getInteger('stufe', true) }
          : sub === 'team'
            ? { action: 'team', team: o.getString('team', true) }
            : { action: sub };
    await api.post(`/api/v1/roblox/players/${player.userId}/actions`, { command, reason: o.getString('grund', true) });
    return reply(
      interaction,
      `${ACTION_DONE[sub] ?? sub} für **${player.username}** an ${serverLabel(player.server)} gesendet. Der Server führt die Aktion in wenigen Sekunden aus – Ergebnis mit \`/ingame history\`.`,
    );
  },
});
