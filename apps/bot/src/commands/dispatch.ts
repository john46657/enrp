import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  type SlashCommandIntegerOption,
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
