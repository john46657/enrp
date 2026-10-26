import { SlashCommandBuilder, type SlashCommandStringOption } from 'discord.js';
import { defineCommand } from '../command';
import { dur, embed, reply, table, ts } from '../ui';

const factionChoice = (o: SlashCommandStringOption, withCivil = true) =>
  o.addChoices(
    { name: 'Polizei', value: 'polizei' },
    { name: 'Feuerwehr', value: 'feuerwehr' },
    { name: 'Rettungsdienst', value: 'rettungsdienst' },
    ...(withCivil ? [{ name: 'Zivilisten', value: 'zivil' }] : []),
  );

/** Roblox-Ziel: ID (nur Ziffern) oder Benutzername. */
function robloxTarget(value: string) {
  return /^\d+$/.test(value) ? { robloxUserId: Number(value) } : { robloxUsername: value };
}

export const faction = defineCommand({
  data: new SlashCommandBuilder()
    .setName('faction')
    .setDescription('Fraktionsverwaltung')
    .addSubcommand((s) => s.setName('list').setDescription('Fraktionen mit Mitgliederzahl'))
    .addSubcommand((s) => s.setName('members').setDescription('Mitglieder anzeigen').addStringOption((o) => factionChoice(o.setName('fraktion').setDescription('Fraktion').setRequired(true))))
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Person in Fraktion aufnehmen')
        .addStringOption((o) => factionChoice(o.setName('fraktion').setDescription('Fraktion').setRequired(true)))
        .addStringOption((o) => o.setName('roblox').setDescription('Roblox-Name oder -ID').setRequired(true).setMaxLength(40))
        .addStringOption((o) => o.setName('grund').setDescription('Begründung').setRequired(true).setMinLength(3).setMaxLength(300)),
    )
    .addSubcommand((s) =>
      s
        .setName('transfer')
        .setDescription('Person in andere Fraktion versetzen')
        .addStringOption((o) => o.setName('roblox').setDescription('Roblox-Name oder -ID').setRequired(true).setMaxLength(40))
        .addStringOption((o) => factionChoice(o.setName('ziel').setDescription('Neue Fraktion').setRequired(true)))
        .addStringOption((o) => o.setName('grund').setDescription('Begründung').setRequired(true).setMinLength(3).setMaxLength(300)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Person aus ihrer Fraktion entfernen')
        .addStringOption((o) => o.setName('roblox').setDescription('Roblox-Name oder -ID').setRequired(true).setMaxLength(40))
        .addStringOption((o) => o.setName('grund').setDescription('Begründung').setRequired(true).setMinLength(3).setMaxLength(300)),
    ),
  async execute(interaction, { api }) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const { items } = await api.get<{ items: Array<{ name: string; memberCount: number; hasDuty: boolean; isActive: boolean }> }>('/api/v1/factions');
      return reply(interaction, embed().setTitle('🏛️ Fraktionen').setDescription(items.map((f) => `**${f.name}** – ${f.memberCount} Mitglieder${f.hasDuty ? ' · Dienstsystem' : ''}${f.isActive ? '' : ' · deaktiviert'}`).join('\n')));
    }
    if (sub === 'members') {
      const key = interaction.options.getString('fraktion', true);
      const res = await api.get<{ items: Array<{ username: string; joinedAt: string }>; total: number }>(`/api/v1/factions/${key}/members`, { query: { pageSize: 50 } });
      return reply(interaction, embed().setTitle(`👥 ${key} (${res.total})`).setDescription(res.items.map((m) => `${m.username} – seit ${ts(m.joinedAt, 'd')}`).join('\n') || 'Keine Mitglieder.'));
    }
    const reason = interaction.options.getString('grund', true);
    const target = robloxTarget(interaction.options.getString('roblox', true));
    if (sub === 'remove') {
      const r = await api.post<{ factionKey: string }>('/api/v1/factions/members/remove', { ...target, reason });
      return reply(interaction, `✅ Aus der Fraktion **${r.factionKey}** entfernt. Ein laufender Dienst wurde beendet.`);
    }
    const key = sub === 'add' ? interaction.options.getString('fraktion', true) : interaction.options.getString('ziel', true);
    const r = await api.post<{ previousFaction: string | null }>(`/api/v1/factions/${key}/members`, { ...target, reason });
    return reply(interaction, r.previousFaction ? `✅ Versetzt: ${r.previousFaction} → **${key}**.` : `✅ In **${key}** aufgenommen.`);
  },
});

export const duty = defineCommand({
  data: new SlashCommandBuilder()
    .setName('duty')
    .setDescription('Dienstsystem')
    .addSubcommand((s) => s.setName('status').setDescription('Wer ist gerade im Dienst?'))
    .addSubcommand((s) =>
      s
        .setName('stats')
        .setDescription('Dienststatistik')
        .addStringOption((o) => factionChoice(o.setName('fraktion').setDescription('Fraktion'), false))
        .addStringOption((o) => o.setName('roblox').setDescription('Roblox-ID einer Person'))
        .addStringOption((o) => o.setName('zeitraum').setDescription('Zeitraum').addChoices({ name: 'Heute', value: 'day' }, { name: 'Woche', value: 'week' }, { name: 'Monat', value: 'month' }, { name: 'Gesamt', value: 'all' })),
    )
    .addSubcommand((s) =>
      s
        .setName('sessions')
        .setDescription('Letzte Dienstsessions (Team)')
        .addStringOption((o) => factionChoice(o.setName('fraktion').setDescription('Fraktion'), false))
        .addBooleanOption((o) => o.setName('auffaellig').setDescription('Nur markierte Sessions')),
    ),
  async execute(interaction, { api }) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'status') {
      const { items } = await api.get<{ items: Array<{ factionKey: string; count: number }> }>('/api/v1/duty/on-duty');
      return reply(interaction, embed().setTitle('🚨 Aktuell im Dienst').setDescription(items.length ? items.map((i) => `**${i.factionKey}:** ${i.count}`).join('\n') : 'Niemand im Dienst.'));
    }
    if (sub === 'stats') {
      const period = interaction.options.getString('zeitraum') ?? 'week';
      const r = await api.get<{ totalSeconds: number; sessions: number; perFaction: Array<{ factionName: string; seconds: number; sessions: number }> }>('/api/v1/duty/stats', {
        query: { period, faction: interaction.options.getString('fraktion') ?? undefined, robloxUserId: interaction.options.getString('roblox') ?? undefined },
      });
      return reply(
        interaction,
        embed()
          .setTitle(`📈 Dienststatistik (${period})`)
          .setDescription(table([['Gesamt', `${dur(r.totalSeconds)} in ${r.sessions} Sessions`], ...r.perFaction.map((f) => [f.factionName, `${dur(f.seconds)} (${f.sessions})`] as [string, string])])),
      );
    }
    const r = await api.get<{ items: Array<{ username: string; factionName: string; status: string; startedAt: string; durationSeconds: number | null; flags: string[] }> }>('/api/v1/duty/sessions', {
      query: { faction: interaction.options.getString('fraktion') ?? undefined, flagged: interaction.options.getBoolean('auffaellig') ?? undefined, pageSize: 15, period: 'month' },
    });
    return reply(
      interaction,
      embed()
        .setTitle('🗂️ Dienstsessions')
        .setDescription(r.items.map((s) => `${ts(s.startedAt, 'd')} ${s.username} (${s.factionName}) – ${s.durationSeconds !== null ? dur(s.durationSeconds) : 'läuft'}${s.flags.length ? ` ⚠️ ${s.flags.join(', ')}` : ''}`).join('\n') || 'Keine Sessions.'),
    );
  },
});

export const vehicle = defineCommand({
  data: new SlashCommandBuilder()
    .setName('vehicle')
    .setDescription('Fahrzeugverwaltung')
    .addSubcommand((s) => s.setName('list').setDescription('Fahrzeuge suchen').addStringOption((o) => o.setName('suche').setDescription('Name oder Kennung')))
    .addSubcommand((s) => s.setName('info').setDescription('Fahrzeugdetails').addStringOption((o) => o.setName('kennung').setDescription('Fahrzeugkennung').setRequired(true))),
  async execute(interaction, { api }) {
    if (interaction.options.getSubcommand() === 'list') {
      const r = await api.get<{ items: Array<{ vehicle: { identifier: string; name: string; status: string }; factionName: string | null; categoryName: string | null }>; total: number }>('/api/v1/vehicles', {
        query: { q: interaction.options.getString('suche') ?? undefined, pageSize: 25 },
      });
      return reply(interaction, embed().setTitle(`🚗 Fahrzeuge (${r.total})`).setDescription(r.items.map((v) => `\`${v.vehicle.identifier}\` ${v.vehicle.name} · ${v.categoryName ?? '–'} · ${v.factionName ?? 'alle'} · ${v.vehicle.status}`).join('\n') || 'Keine Fahrzeuge konfiguriert.'));
    }
    const r = await api.get<{ vehicle: { identifier: string; name: string; status: string; allowedConfigs: Record<string, string[]>; notes: string }; assignments: Array<{ username: string; assignment: { unassignedAt: string | null } }> }>(
      `/api/v1/vehicles/${encodeURIComponent(interaction.options.getString('kennung', true))}`,
    );
    const configs = Object.entries(r.vehicle.allowedConfigs).map(([k, v]) => `${k}: ${v.join(', ')}`);
    return reply(
      interaction,
      embed()
        .setTitle(`🚗 ${r.vehicle.name}`)
        .setDescription(table([['Kennung', r.vehicle.identifier], ['Status', r.vehicle.status], ['Konfigurationen', configs.join('\n') || '–'], ['Zugewiesen an', r.assignments.filter((a) => !a.assignment.unassignedAt).map((a) => a.username).join(', ') || '–']])),
    );
  },
});
