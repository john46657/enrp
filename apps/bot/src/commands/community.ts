import { ChannelType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../command';
import { describeError } from '../api';
import { embed, reply, trunc, ts } from '../ui';

export const suggest = defineCommand({
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Vorschläge')
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Vorschlag einreichen')
        .addStringOption((o) => o.setName('titel').setDescription('Kurzer Titel').setRequired(true).setMaxLength(120))
        .addStringOption((o) => o.setName('beschreibung').setDescription('Was soll sich ändern und warum?').setRequired(true).setMinLength(10).setMaxLength(2000)),
    )
    .addSubcommand((s) =>
      s
        .setName('status')
        .setDescription('Status setzen (Team)')
        .addIntegerOption((o) => o.setName('nummer').setDescription('Vorschlagsnummer').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Neuer Status')
            .setRequired(true)
            .addChoices({ name: 'In Prüfung', value: 'under_review' }, { name: 'Angenommen', value: 'accepted' }, { name: 'Abgelehnt', value: 'rejected' }, { name: 'Umgesetzt', value: 'implemented' }, { name: 'Offen', value: 'open' }),
        )
        .addStringOption((o) => o.setName('begruendung').setDescription('Begründung').setRequired(true).setMinLength(3).setMaxLength(500)),
    ),
  async execute(interaction, { api }) {
    if (interaction.options.getSubcommand() === 'create') {
      const s = await api.post<{ number: number }>(
        '/api/v1/suggestions',
        { title: interaction.options.getString('titel', true), body: interaction.options.getString('beschreibung', true) },
        { idempotencyKey: `suggest-${interaction.id}` },
      );
      return reply(interaction, `✅ Vorschlag **#${s.number}** eingereicht. Er erscheint gleich im Vorschlagskanal (sofern eingerichtet).`);
    }
    const s = await api.post<{ number: number; status: string }>(`/api/v1/suggestions/${interaction.options.getInteger('nummer', true)}/status`, {
      status: interaction.options.getString('status', true),
      reason: interaction.options.getString('begruendung', true),
    });
    return reply(interaction, `✅ Vorschlag #${s.number}: **${s.status}**.`);
  },
  components: {
    // Abstimmungsbuttons unter Vorschlägen: sg:up:<id> / sg:down:<id>
    async sg(interaction, [direction, id], { api }) {
      if (!interaction.isButton()) return;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const tally = await api.post<{ up: number; down: number }>(`/api/v1/suggestions/${id}/vote`, { value: direction === 'up' ? 1 : -1 });
        const current = interaction.message.embeds[0];
        if (current) {
          const updated = embed().setTitle(current.title).setDescription(current.description).setFooter(current.footer).addFields({ name: '👍 Dafür', value: String(tally.up), inline: true }, { name: '👎 Dagegen', value: String(tally.down), inline: true });
          await interaction.message.edit({ embeds: [updated] }).catch(() => {});
        }
        return interaction.editReply('✅ Deine Stimme wurde gezählt (du kannst sie jederzeit ändern).');
      } catch (err) {
        return interaction.editReply(`❌ ${describeError(err)}`);
      }
    },
  },
});

export const poll = defineCommand({
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Umfragen')
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Umfrage erstellen')
        .addStringOption((o) => o.setName('frage').setDescription('Frage').setRequired(true).setMaxLength(200))
        .addStringOption((o) => o.setName('antworten').setDescription('Antworten, getrennt mit ;').setRequired(true).setMaxLength(800))
        .addChannelOption((o) => o.setName('kanal').setDescription('Kanal (Standard: hier)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addNumberOption((o) => o.setName('stunden').setDescription('Laufzeit in Stunden').setMinValue(0.1).setMaxValue(720))
        .addBooleanOption((o) => o.setName('mehrfach').setDescription('Mehrfachauswahl erlauben')),
    )
    .addSubcommand((s) => s.setName('close').setDescription('Umfrage beenden').addStringOption((o) => o.setName('id').setDescription('Umfrage-ID').setRequired(true))),
  async execute(interaction, { api }) {
    if (interaction.options.getSubcommand() === 'close') {
      await api.post(`/api/v1/polls/${interaction.options.getString('id', true)}/close`);
      return reply(interaction, '✅ Umfrage beendet.');
    }
    const channel = interaction.options.getChannel('kanal') ?? interaction.channel;
    const p = await api.post<{ id: string }>('/api/v1/polls', {
      question: interaction.options.getString('frage', true),
      options: interaction.options.getString('antworten', true).split(';'),
      durationHours: interaction.options.getNumber('stunden') ?? undefined,
      multipleChoice: interaction.options.getBoolean('mehrfach') ?? false,
      channelId: channel?.id,
    });
    return reply(interaction, `✅ Umfrage angelegt (ID \`${p.id}\`). Sie wird gleich in <#${channel?.id}> veröffentlicht.`);
  },
  components: {
    // poll:<pollId>:<optionId> – Mehrfachauswahl: jeder Klick ersetzt die Stimme durch diese Antwort.
    async poll(interaction, [pollId, optionId], { api }) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        await api.post(`/api/v1/polls/${pollId}/vote`, { optionIds: [optionId] });
        return interaction.editReply('✅ Stimme gespeichert. Die Anzeige aktualisiert sich beim Beenden der Umfrage und im Dashboard live.');
      } catch (err) {
        return interaction.editReply(`❌ ${describeError(err)}`);
      }
    },
  },
});

export const giveaway = defineCommand({
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Giveaways')
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Giveaway starten')
        .addStringOption((o) => o.setName('preis').setDescription('Preis').setRequired(true).setMaxLength(150))
        .addNumberOption((o) => o.setName('stunden').setDescription('Dauer in Stunden').setRequired(true).setMinValue(0.1).setMaxValue(720))
        .addIntegerOption((o) => o.setName('gewinner').setDescription('Anzahl Gewinner').setMinValue(1).setMaxValue(20))
        .addStringOption((o) => o.setName('beschreibung').setDescription('Beschreibung').setMaxLength(1000))
        .addBooleanOption((o) => o.setName('nur_verifiziert').setDescription('Nur verifizierte Mitglieder (Standard: ja)')),
    )
    .addSubcommand((s) => s.setName('draw').setDescription('Jetzt auslosen').addStringOption((o) => o.setName('id').setDescription('Giveaway-ID').setRequired(true)))
    .addSubcommand((s) =>
      s
        .setName('cancel')
        .setDescription('Abbrechen')
        .addStringOption((o) => o.setName('id').setDescription('Giveaway-ID').setRequired(true))
        .addStringOption((o) => o.setName('grund').setDescription('Grund').setRequired(true).setMinLength(3)),
    ),
  async execute(interaction, { api }) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'draw') {
      const g = await api.post<{ winners: string[] }>(`/api/v1/giveaways/${interaction.options.getString('id', true)}/draw`);
      return reply(interaction, `✅ Ausgelost: ${g.winners.length ? g.winners.map((w) => `<@${w}>`).join(', ') : 'keine Teilnahmen'}`);
    }
    if (sub === 'cancel') {
      await api.post(`/api/v1/giveaways/${interaction.options.getString('id', true)}/cancel`, { reason: interaction.options.getString('grund', true) });
      return reply(interaction, '✅ Giveaway abgebrochen.');
    }
    const g = await api.post<{ id: string; endsAt: string }>('/api/v1/giveaways', {
      prize: interaction.options.getString('preis', true),
      durationHours: interaction.options.getNumber('stunden', true),
      winnerCount: interaction.options.getInteger('gewinner') ?? 1,
      description: interaction.options.getString('beschreibung') ?? undefined,
      requireVerified: interaction.options.getBoolean('nur_verifiziert') ?? true,
      channelId: interaction.channelId,
    });
    return reply(interaction, `✅ Giveaway gestartet (ID \`${g.id}\`), endet ${ts(g.endsAt, 'R')}.`);
  },
  components: {
    async gw(interaction, [, id], { api }) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const r = await api.post<{ entered: boolean; entries: number }>(`/api/v1/giveaways/${id}/enter`);
        return interaction.editReply(r.entered ? `🎉 Du nimmst teil! (${r.entries} Teilnahmen)` : 'Du nimmst bereits teil.');
      } catch (err) {
        return interaction.editReply(`❌ ${describeError(err)}`);
      }
    },
  },
});

export const announce = defineCommand({
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Ankündigungen')
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Ankündigung veröffentlichen')
        .addStringOption((o) => o.setName('titel').setDescription('Titel').setRequired(true).setMaxLength(200))
        .addStringOption((o) => o.setName('text').setDescription('Text (\\n für Zeilenumbruch)').setRequired(true).setMaxLength(3500))
        .addStringOption((o) => o.setName('art').setDescription('Art').addChoices({ name: 'Allgemein', value: 'general' }, { name: 'Changelog', value: 'changelog' }, { name: 'Wartung', value: 'maintenance' }))
        .addChannelOption((o) => o.setName('kanal').setDescription('Kanal (Standard: Ankündigungskanal)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addBooleanOption((o) => o.setName('im_spiel').setDescription('Auch im Roblox-Spiel anzeigen'))
        .addStringOption((o) => o.setName('version').setDescription('Version (Changelog)').setMaxLength(40)),
    ),
  async execute(interaction, { api }) {
    const a = await api.post<{ id: string }>(
      '/api/v1/announcements',
      {
        title: interaction.options.getString('titel', true),
        body: interaction.options.getString('text', true).replace(/\\n/g, '\n'),
        kind: interaction.options.getString('art') ?? 'general',
        channelId: interaction.options.getChannel('kanal')?.id,
        inGame: interaction.options.getBoolean('im_spiel') ?? false,
        version: interaction.options.getString('version') ?? undefined,
      },
      { idempotencyKey: `announce-${interaction.id}` },
    );
    await api.post(`/api/v1/announcements/${a.id}/publish`);
    return reply(interaction, '✅ Ankündigung veröffentlicht.');
  },
});

export const rules = defineCommand({
  data: new SlashCommandBuilder()
    .setName('rules')
    .setDescription('Regelwerk')
    .addSubcommand((s) => s.setName('show').setDescription('Aktuelles Regelwerk anzeigen'))
    .addSubcommand((s) => s.setName('accept').setDescription('Regelwerk bestätigen')),
  async execute(interaction, { api }) {
    if (interaction.options.getSubcommand() === 'accept') {
      const r = await api.post<{ version: number }>('/api/v1/rules/accept');
      return reply(interaction, `✅ Danke! Du hast das Regelwerk (Version ${r.version}) bestätigt.`);
    }
    const { rules: r } = await api.get<{ rules: { title: string; content: string; version: number; publishedAt: string } | null }>('/api/v1/rules');
    if (!r) return reply(interaction, 'Es wurde noch kein Regelwerk veröffentlicht.');
    return reply(interaction, embed().setTitle(`📜 ${r.title} (v${r.version})`).setDescription(trunc(r.content, 4000)).setFooter({ text: 'Mit /rules accept bestätigen' }));
  },
});
