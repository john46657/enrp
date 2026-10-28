// Server-Sicherheit (security in config.json): Verify-Button, Mindest-Account-Alter und Anti-Raid-Alarm.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { forGuild } = require('./settings');
const { embed, getChannel, replyPrivate } = require('./util');

const settingsOf = (guildId) => forGuild(guildId).security;
const DAY = 86_400_000;
const joins = new Map(); // guildId → Zeitpunkte der letzten Beitritte
const lastAlarm = new Map(); // guildId → Zeitpunkt

async function log(guild, color, text) {
  const channel = await getChannel(guild, settingsOf(guild.id).logChannel || forGuild(guild.id).channels.modLog);
  if (channel?.isTextBased()) await channel.send({ embeds: [embed(color).setTitle('🔒 Server-Sicherheit').setDescription(text)], allowedMentions: { parse: [] } }).catch(() => {});
}

// ---------- Verify ----------

function verifyMessage(guildId) {
  const { verify } = settingsOf(guildId);
  return {
    embeds: [embed('success').setTitle(verify.title || '✅ Verifizierung').setDescription(verify.text || 'Klicke auf den Button.')],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify:go').setLabel((verify.button || 'Verifizieren').slice(0, 80)).setStyle(ButtonStyle.Success).setEmoji('✅'))],
  };
}

async function postVerifyMessage(guild) {
  const { verify } = settingsOf(guild.id);
  if (!verify.role) throw new Error('Keine Verify-Rolle eingestellt.');
  const channel = await getChannel(guild, verify.channel);
  if (!channel?.isTextBased()) throw new Error('Kein Verify-Kanal eingestellt.');
  await channel.send(verifyMessage(guild.id));
}

async function handleVerify(interaction) {
  const { enabled, verify } = settingsOf(interaction.guildId);
  if (!enabled || !verify.enabled || !verify.role) return replyPrivate(interaction, 'Die Verifizierung ist gerade nicht aktiv.');
  const member = interaction.member;
  if (member.roles.cache.has(verify.role)) return replyPrivate(interaction, 'Du bist bereits verifiziert. ✅');
  try {
    await member.roles.add(verify.role, 'Verifiziert');
    if (verify.removeRole && member.roles.cache.has(verify.removeRole)) await member.roles.remove(verify.removeRole, 'Verifiziert');
  } catch (err) {
    console.error('[verify]', err.message);
    return replyPrivate(interaction, 'Das hat nicht geklappt – bitte melde dich beim Team.');
  }
  await log(interaction.guild, 'success', `✅ ${member} hat sich verifiziert.`);
  return replyPrivate(interaction, '✅ Du bist jetzt verifiziert. Willkommen!');
}

// ---------- Beitritte ----------

// Gibt true zurück, wenn das Mitglied wegen Account-Alter entfernt wurde (dann keine Willkommensnachricht).
async function handleJoin(member) {
  const { enabled, accountAge, antiRaid } = settingsOf(member.guild.id);
  if (!enabled) return false;

  if (antiRaid.enabled) {
    const now = Date.now();
    const list = (joins.get(member.guild.id) ?? []).filter((t) => now - t < antiRaid.seconds * 1000);
    list.push(now);
    joins.set(member.guild.id, list);
    if (list.length >= antiRaid.joins && now - (lastAlarm.get(member.guild.id) ?? 0) > 10 * 60_000) {
      lastAlarm.set(member.guild.id, now);
      const channel = await getChannel(member.guild, settingsOf(member.guild.id).logChannel || forGuild(member.guild.id).channels.modLog);
      await channel
        ?.send({
          content: antiRaid.pingRoles.map((id) => `<@&${id}>`).join(' ') || undefined,
          embeds: [embed('danger').setTitle('🚨 Raid-Alarm').setDescription(`${list.length} Beitritte in ${antiRaid.seconds} Sekunden. Bitte prüfen – es wird niemand automatisch entfernt.`)],
          allowedMentions: { roles: antiRaid.pingRoles },
        })
        .catch(() => {});
    }
  }

  if (accountAge.enabled && !member.user.bot) {
    const ageDays = (Date.now() - member.user.createdTimestamp) / DAY;
    if (ageDays < accountAge.minDays) {
      const text = `Dein Discord-Account ist jünger als ${accountAge.minDays} Tage. Bitte versuche es später erneut.`;
      if (accountAge.dm && accountAge.action !== 'log') await member.send(`**${member.guild.name}:** ${text}`).catch(() => {});
      const age = `${Math.floor(ageDays)} Tage`;
      try {
        if (accountAge.action === 'kick') await member.kick(`Account zu neu (${age})`);
        else if (accountAge.action === 'timeout') await member.timeout(Math.min(28, Math.ceil(accountAge.minDays - ageDays)) * DAY, `Account zu neu (${age})`);
      } catch (err) {
        console.error('[accountAge]', err.message);
      }
      const verb = { kick: 'gekickt', timeout: 'stummgeschaltet', log: 'nur gemeldet' }[accountAge.action] ?? accountAge.action;
      await log(member.guild, 'warning', `🆕 ${member} (${member.user.username}) – Account ist ${age} alt (Minimum ${accountAge.minDays}) → ${verb}.`);
      return accountAge.action === 'kick';
    }
  }
  return false;
}

module.exports = { postVerifyMessage, handleVerify, handleJoin, verifyMessage };
