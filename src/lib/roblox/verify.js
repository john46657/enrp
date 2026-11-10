// Gibt einem verifizierten Mitglied auf diesem Discord-Server die Verifiziert-Rolle und setzt den Roblox-Namen als Nickname.
const { forGuild } = require('../settings');
const { getAccount } = require('./links');

async function applyVerification(member) {
  const account = getAccount(member.id);
  const config = forGuild(member.guild.id);
  const problems = [];
  const roleId = config.roles.verified;

  if (roleId) {
    const action = account ? 'add' : 'remove';
    if (account ? !member.roles.cache.has(roleId) : member.roles.cache.has(roleId)) {
      await member.roles[action](roleId, 'Roblox-Verifizierung').catch(() => problems.push('Rolle konnte nicht vergeben werden (Bot-Rolle zu niedrig?)'));
    }
  }

  if (account && config.roblox.setNickname && member.id !== member.guild.ownerId && member.nickname !== account.name) {
    await member.setNickname(account.name, 'Roblox-Verifizierung').catch(() => problems.push('Nickname konnte nicht gesetzt werden (Bot-Rolle zu niedrig?)'));
  }
  return problems;
}

module.exports = { applyVerification };
