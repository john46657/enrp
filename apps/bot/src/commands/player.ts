import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder, type User } from 'discord.js';
import { AppError, BRAND } from '@emden-network/shared';
import { getActiveLinkByDiscord, getMembership, getProfile } from '@emden-network/core';
import { buildActor, type Command, type CommandContext } from '../context.js';
import { embed, formatDuration, ts } from '../format.js';

/** Prüft, ob der Aufrufer Daten eines anderen Spielers sehen darf (Leitungen nur für die eigene Fraktion). */
async function requireProfileAccess(ctx: CommandContext, target: User): Promise<void> {
  if (target.id === ctx.actor.discordId) return ctx.require('self.read');
  const m = await getMembership(ctx.services.pool, target.id);
  await ctx.require('player.read_any', m?.factionKey);
}

export const verify: Command = {
  data: new SlashCommandBuilder().setName('verify').setDescription('Verknüpfe deinen Roblox-Account und erhalte die Rolle „Verifiziert“'),
  async execute(ctx) {
    const existing = await getActiveLinkByDiscord(ctx.services.pool, ctx.actor.discordId);
    if (existing) {
      await ctx.reply(`✅ Du bist bereits mit **${existing.robloxUsername ?? existing.robloxUserId}** verknüpft. Zum Wechseln zuerst \`/unlink\` ausführen.`);
      return;
    }
    const { url, expiresAt } = await ctx.services.verification.createSession(ctx.actor.discordId, ctx.guildId);
    const e = embed('Roblox-Verifizierung', [
      `Klicke auf **Mit Roblox verbinden** und melde dich auf der offiziellen Roblox-Seite an.`,
      '',
      '• Wir fragen nur deine Roblox-ID und deinen Namen ab (Scopes `openid` und `profile`).',
      '• Gib dein Roblox-Passwort **niemals** in Discord oder auf anderen Seiten ein.',
      '• Der Link gilt nur für dich und ist einmalig verwendbar – teile ihn nicht.',
      `• Gültig bis ${ts(expiresAt, 't')} (${ts(expiresAt, 'R')}). Danach einfach \`/verify\` erneut ausführen.`,
    ].join('\n'));
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Mit Roblox verbinden').setURL(url),
    );
    await ctx.reply({ embeds: [e], components: [row] });
  },
};

export const unlink: Command = {
  data: new SlashCommandBuilder().setName('unlink').setDescription('Hebe die Verknüpfung mit deinem Roblox-Account auf'),
  async execute(ctx) {
    const link = await getActiveLinkByDiscord(ctx.services.pool, ctx.actor.discordId);
    if (!link) throw new AppError('NOT_LINKED', 404);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`unlink:confirm:${ctx.actor.discordId}`).setStyle(ButtonStyle.Danger).setLabel('Verknüpfung aufheben'),
      new ButtonBuilder().setCustomId(`unlink:cancel:${ctx.actor.discordId}`).setStyle(ButtonStyle.Secondary).setLabel('Abbrechen'),
    );
    await ctx.reply({
      content: `Möchtest du die Verknüpfung mit **${link.robloxUsername ?? link.robloxUserId}** wirklich aufheben? Du verlierst die Rolle **Verifiziert**; deine Fraktionsmitgliedschaft bleibt bestehen.`,
      components: [row],
    });
  },
  buttons: {
    async unlink(i, services) {
      const [, action, ownerId] = i.customId.split(':');
      // Nur der Nutzer, der /unlink ausgeführt hat, darf bestätigen.
      if (ownerId !== i.user.id) {
        await i.reply({ content: 'Diese Schaltfläche gehört nicht dir.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (action !== 'confirm') {
        await i.update({ content: 'Abgebrochen.', components: [] });
        return;
      }
      await buildActor(i, services); // stellt sicher, dass wir im Server sind
      await services.verification.revokeLink({ discordId: i.user.id, guildId: i.guildId!, actorDiscordId: i.user.id, reason: 'Durch Nutzer aufgehoben (/unlink)' });
      await i.update({ content: '✅ Verknüpfung aufgehoben. Die Rolle **Verifiziert** wird in Kürze entfernt.', components: [] });
    },
  },
};

export const profile: Command = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Zeigt ein Spielerprofil')
    .addUserOption((o) => o.setName('spieler').setDescription('Spieler (leer = du selbst)')),
  async execute(ctx) {
    const target = ctx.i.options.getUser('spieler') ?? ctx.i.user;
    await requireProfileAccess(ctx, target);
    const p = await getProfile(ctx.services.pool, { discordId: target.id });
    if (!p?.roblox) {
      await ctx.reply(target.id === ctx.actor.discordId ? 'Du bist noch nicht verifiziert. Nutze `/verify`.' : `<@${target.id}> ist nicht verifiziert.`);
      return;
    }
    const e = embed(`Profil von ${target.displayName}`)
      .setThumbnail(target.displayAvatarURL())
      .addFields(
        { name: 'Roblox', value: `${p.roblox.username ?? '–'} (${p.roblox.id})`, inline: true },
        { name: 'Verknüpft seit', value: ts(p.roblox.linkedAt, 'd'), inline: true },
        { name: 'Fraktion', value: p.faction ? `${p.faction.name} – ${p.faction.rank.name}` : 'Keine', inline: false },
        { name: 'Im Dienst', value: p.onDuty ? 'Ja' : 'Nein', inline: true },
        { name: 'Dienstzeit (30 Tage)', value: formatDuration(p.dutyTime.last30DaysSeconds), inline: true },
        { name: 'Spielzeit (30 Tage)', value: formatDuration(p.playTime?.last30DaysSeconds ?? 0), inline: true },
      );
    await ctx.reply({ embeds: [e] });
  },
};

export const playtime: Command = {
  data: new SlashCommandBuilder()
    .setName('playtime')
    .setDescription('Zeigt Spiel- und Dienstzeit')
    .addUserOption((o) => o.setName('spieler').setDescription('Spieler (leer = du selbst)')),
  async execute(ctx) {
    const target = ctx.i.options.getUser('spieler') ?? ctx.i.user;
    await requireProfileAccess(ctx, target);
    const p = await getProfile(ctx.services.pool, { discordId: target.id });
    if (!p?.roblox) {
      await ctx.reply('Keine Daten – der Spieler ist nicht verifiziert.');
      return;
    }
    const e = embed(`Zeiten von ${target.displayName}`).addFields(
      { name: 'Spielzeit gesamt', value: formatDuration(p.playTime?.totalSeconds ?? 0), inline: true },
      { name: 'Spielzeit 30 Tage', value: formatDuration(p.playTime?.last30DaysSeconds ?? 0), inline: true },
      { name: '​', value: '​', inline: true },
      { name: 'Dienstzeit gesamt', value: formatDuration(p.dutyTime.totalSeconds), inline: true },
      { name: 'Dienstzeit 30 Tage', value: formatDuration(p.dutyTime.last30DaysSeconds), inline: true },
    );
    await ctx.reply({ embeds: [e] });
  },
};

export const myfaction: Command = {
  data: new SlashCommandBuilder().setName('myfaction').setDescription('Zeigt deine Fraktion und deinen Rang'),
  async execute(ctx) {
    await ctx.require('self.read');
    const m = await getMembership(ctx.services.pool, ctx.actor.discordId);
    if (!m) {
      await ctx.reply('Du bist in keiner Fraktion. Bewirb dich bei einer Fraktionsleitung.');
      return;
    }
    const onDuty = await ctx.services.duty.current(ctx.actor.discordId);
    await ctx.reply({
      embeds: [
        embed(m.factionName).addFields(
          { name: 'Rang', value: m.rank.name, inline: true },
          { name: 'Mitglied seit', value: ts(m.joinedAt, 'd'), inline: true },
          { name: 'Dienst', value: onDuty ? `seit ${ts(onDuty.startedAt, 'R')}` : 'nicht im Dienst', inline: true },
        ),
      ],
    });
  },
};

const HELP: [string, string][] = [
  ['Spieler', '`/verify` `/unlink` `/profile` `/playtime` `/myfaction` `/privacy`'],
  ['Fraktion', '`/faction info|roster|invite|remove|promote|demote|setrank|announce|audit`'],
  ['Dienst', '`/duty start|stop|status|roster|stats|correct|export`'],
  ['Moderation', '`/warn` `/timeout` `/case view` `/gamekick` `/gameban`'],
  ['Server', '`/server status|players|announce|maintenance|restart-announce`'],
  ['System', '`/system health|audit|config`'],
];

export const help: Command = {
  data: new SlashCommandBuilder().setName('help').setDescription(`Übersicht der Befehle von ${BRAND.name}`),
  async execute(ctx) {
    const e = embed(`${BRAND.name} – Hilfe`, 'Welche Befehle du nutzen darfst, hängt von deinen Rollen ab. Jede Aktion wird serverseitig geprüft.');
    for (const [name, value] of HELP) e.addFields({ name, value });
    await ctx.reply({ embeds: [e] });
  },
};

export const privacy: Command = {
  data: new SlashCommandBuilder().setName('privacy').setDescription('Datenschutz: welche Daten wir speichern'),
  async execute(ctx) {
    const e = embed(`Datenschutz bei ${BRAND.name}`).addFields(
      { name: 'Was wir speichern', value: 'Discord-ID, Roblox-ID, Roblox-Benutzer- und Anzeigename, Fraktion/Rang, Dienst- und Spielzeiten, Moderationsfälle und ein Audit-Log kritischer Aktionen.' },
      { name: 'Was wir nicht speichern', value: 'Keine Passwörter, keine E-Mail-Adressen und keine Roblox-Zugangstoken – diese werden direkt nach der Identitätsprüfung verworfen.' },
      { name: 'Aufbewahrung', value: 'Anmelde-Sessions: 24 Stunden. Spielereignisse: 90 Tage. Audit-Logs: 1 Jahr. Details in der Projektdokumentation (docs/datenschutz.md).' },
      { name: 'Deine Rechte', value: 'Mit `/unlink` hebst du die Verknüpfung jederzeit auf. Für Auskunft oder Löschung öffne ein Ticket beim Team.' },
    );
    await ctx.reply({ embeds: [e] });
  },
};

export const playerCommands = [verify, unlink, profile, playtime, myfaction, help, privacy];
