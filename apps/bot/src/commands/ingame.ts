import { MessageFlags, SlashCommandBuilder, type SlashCommandStringOption } from 'discord.js';
import { defineCommand } from '../command';
import { type ApiClient } from '@enrp/shared';
import { describeError } from '../api';
import { embed, reply, trunc, ts } from '../ui';

/**
 * Fahndungen (/bolo) und Aktionen an Spielern im Spiel (/ingame). Der Bot ruft nur die API auf – Rechte,
 * Audit-Log und die Suche nach dem richtigen Server übernimmt die Plattform.
 */

interface Bolo {
  id: string;
  number: number;
  kind: 'vehicle' | 'person';
  plate: string | null;
  robloxUserId: number | null;
  username?: string | null;
  reason: string;
  description: string;
  status: 'active' | 'cleared';
  hitCount: number;
  lastHitAt: string | null;
  createdAt: string;
}

interface LivePlayer {
  userId: number;
  username: string;
  displayName?: string;
}

const boloTarget = (b: Bolo) =>
  b.kind === 'vehicle' ? `🚗 **${b.plate}**` : `👤 **${b.username ?? b.robloxUserId}** (\`${b.robloxUserId}\`)`;

const reason = (o: SlashCommandStringOption) =>
  o.setName('grund').setDescription('Grund (steht im Audit-Log)').setRequired(true).setMinLength(3).setMaxLength(300);

export const boloCommand = defineCommand({
  data: new SlashCommandBuilder()
    .setName('bolo')
    .setDescription('Fahndungen mit Alarm, sobald der Gesuchte im Spiel auftaucht')
    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('Aktive Fahndungen (oder alle)')
        .addBooleanOption((o) => o.setName('alle').setDescription('Auch aufgehobene')),
    )
    .addSubcommand((s) =>
      s
        .setName('vehicle')
        .setDescription('Fahndung nach Kennzeichen')
        .addStringOption((o) =>
          o.setName('kennzeichen').setDescription('Kennzeichen').setRequired(true).setMinLength(2).setMaxLength(16),
        )
        .addStringOption(reason)
        .addStringOption((o) =>
          o.setName('beschreibung').setDescription('Fahrzeug, Farbe, Insassen …').setMaxLength(500),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('person')
        .setDescription('Fahndung nach Spieler')
        .addIntegerOption((o) => o.setName('roblox_id').setDescription('Roblox-ID').setRequired(true).setMinValue(1))
        .addStringOption(reason)
        .addStringOption((o) => o.setName('beschreibung').setDescription('Kleidung, bewaffnet …').setMaxLength(500)),
    )
    .addSubcommand((s) =>
      s
        .setName('clear')
        .setDescription('Fahndung aufheben')
        .addIntegerOption((o) => o.setName('nummer').setDescription('BOLO-Nummer').setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName('notiz').setDescription('z. B. Fahrzeug sichergestellt').setMaxLength(1000)),
    ),
  async execute(interaction, { api }) {
    const o = interaction.options;
    const sub = o.getSubcommand();
    if (sub === 'list') {
      const query = new URLSearchParams({ pageSize: '25' });
      if (!o.getBoolean('alle')) query.set('status', 'active');
      const res = await api.get<{ items: Bolo[]; total: number }>(`/api/v1/dispatch/bolos?${query}`);
      const lines = res.items.map(
        (b) =>
          `${b.status === 'active' ? '🟥' : '⬜'} **#${b.number}** ${boloTarget(b)} · ${trunc(b.reason, 60)}${
            b.lastHitAt ? ` · zuletzt gesichtet ${ts(b.lastHitAt, 'R')}` : ''
          }`,
      );
      return reply(
        interaction,
        embed()
          .setTitle(`🔎 Fahndungen (${res.total})`)
          .setDescription(trunc(lines.join('\n') || 'Keine Fahndungen.', 4000)),
      );
    }
    if (sub === 'clear') {
      const b = await api.post<Bolo>(`/api/v1/dispatch/bolos/${o.getInteger('nummer', true)}/clear`, {
        note: o.getString('notiz') ?? undefined,
      });
      return reply(interaction, `✅ Fahndung **#${b.number}** aufgehoben.`);
    }
    const body =
      sub === 'vehicle'
        ? { kind: 'vehicle', plate: o.getString('kennzeichen', true) }
        : { kind: 'person', robloxUserId: o.getInteger('roblox_id', true) };
    const b = await api.post<Bolo>('/api/v1/dispatch/bolos', {
      ...body,
      reason: o.getString('grund', true),
      description: o.getString('beschreibung') ?? undefined,
    });
    return reply(
      interaction,
      `🔎 Fahndung **#${b.number}** angelegt: ${boloTarget(b)}.${
        b.hitCount
          ? ' ⚠️ Bereits jetzt im Spiel gesichtet – siehe Leitstellen-Kanal.'
          : ' Bei Sichtung im Spiel kommt ein Alarm.'
      }`,
    );
  },
  components: {
    // Button an Fahndungsnachrichten: bolo:clear:<id>
    async bolo(interaction, [action, id], { api }) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        if (action === 'clear') {
          const b = await api.post<Bolo>(`/api/v1/dispatch/bolos/${id}/clear`, {});
          return interaction.editReply(`✅ Fahndung **#${b.number}** aufgehoben.`);
        }
        return interaction.editReply('Unbekannte Aktion.');
      } catch (err) {
        return interaction.editReply(`❌ ${describeError(err)}`);
      }
    },
  },
});

/** Spieler über Roblox-ID oder Namen (exakt, sonst eindeutiger Teiltreffer) auf den laufenden Servern finden. */
async function findPlayer(api: ApiClient, input: string) {
  const text = input.trim();
  const res = await api.get<{ items: LivePlayer[] }>(`/api/v1/roblox/live/players?${new URLSearchParams({ q: text })}`);
  const lower = text.toLowerCase();
  const exact = res.items.find((p) => String(p.userId) === text || p.username.toLowerCase() === lower);
  if (exact) return exact;
  if (res.items.length === 1) return res.items[0]!;
  if (!res.items.length) throw new Error(`Kein Spieler „${text}“ online.`);
  throw new Error(
    `Mehrere Treffer: ${res.items
      .slice(0, 5)
      .map((p) => p.username)
      .join(', ')} – bitte genauer.`,
  );
}

const player = (o: SlashCommandStringOption) =>
  o.setName('spieler').setDescription('Roblox-Name oder -ID (muss online sein)').setRequired(true).setMaxLength(60);

const DONE: Record<string, string> = {
  jail: '🔒 kommt ins Gefängnis',
  unjail: '🔓 wird entlassen',
  heal: '❤️ wird geheilt',
  kill: '💀 wird getötet',
  respawn: '🔄 wird respawnt',
  wanted: '⭐ bekommt eine neue Fahndungsstufe',
  team: '👕 wechselt das Team',
  pm: '✉️ bekommt deine Nachricht',
  kick: '👢 wird vom Server gekickt',
};

export const ingame = defineCommand({
  data: new SlashCommandBuilder()
    .setName('ingame')
    .setDescription('Aktionen an Spielern im Spiel')
    .addSubcommand((s) =>
      s
        .setName('jail')
        .setDescription('Ins Gefängnis')
        .addStringOption(player)
        .addIntegerOption((o) =>
          o.setName('minuten').setDescription('Dauer').setRequired(true).setMinValue(1).setMaxValue(120),
        )
        .addStringOption(reason),
    )
    .addSubcommand((s) =>
      s.setName('unjail').setDescription('Aus dem Gefängnis entlassen').addStringOption(player).addStringOption(reason),
    )
    .addSubcommand((s) =>
      s
        .setName('wanted')
        .setDescription('Fahndungsstufe setzen (0 = keine)')
        .addStringOption(player)
        .addIntegerOption((o) =>
          o.setName('stufe').setDescription('0–5').setRequired(true).setMinValue(0).setMaxValue(5),
        )
        .addStringOption(reason),
    )
    .addSubcommand((s) => s.setName('heal').setDescription('Heilen').addStringOption(player).addStringOption(reason))
    .addSubcommand((s) =>
      s.setName('respawn').setDescription('Respawn').addStringOption(player).addStringOption(reason),
    )
    .addSubcommand((s) =>
      s
        .setName('team')
        .setDescription('Team setzen')
        .addStringOption(player)
        .addStringOption((o) => o.setName('team').setDescription('Teamname').setRequired(true).setMaxLength(40))
        .addStringOption(reason),
    )
    .addSubcommand((s) =>
      s
        .setName('pm')
        .setDescription('Private Nachricht im Spiel')
        .addStringOption(player)
        .addStringOption((o) => o.setName('nachricht').setDescription('Text').setRequired(true).setMaxLength(300))
        .addStringOption(reason),
    )
    .addSubcommand((s) => s.setName('kill').setDescription('Töten').addStringOption(player).addStringOption(reason))
    .addSubcommand((s) =>
      s.setName('kick').setDescription('Vom Server kicken').addStringOption(player).addStringOption(reason),
    ),
  async execute(interaction, { api }) {
    const o = interaction.options;
    const action = o.getSubcommand();
    const target = await findPlayer(api, o.getString('spieler', true));
    const body: Record<string, unknown> = { action, reason: o.getString('grund', true) };
    if (action === 'jail') body.minutes = o.getInteger('minuten', true);
    if (action === 'wanted') body.level = o.getInteger('stufe', true);
    if (action === 'team') body.team = o.getString('team', true);
    if (action === 'pm') body.message = o.getString('nachricht', true);
    await api.post(`/api/v1/roblox/players/${target.userId}/actions`, body);
    return reply(
      interaction,
      `**${target.username}** ${DONE[action] ?? 'bekommt die Aktion'}. Der Server führt es innerhalb weniger Sekunden aus (Ergebnis unter Dashboard → Roblox-Server).`,
    );
  },
});
