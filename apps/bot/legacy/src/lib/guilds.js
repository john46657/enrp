// Einrichtung eines Servers: beim Start für alle Server und sobald der Bot einem neuen Server beitritt.
const { forGuild } = require('./settings');
const { refreshPanels } = require('./tickets');
const appMessages = require('./applications/messages');

async function setupGuild(guild) {
  // Slash-Commands je Server registrieren: sind sofort da (global dauert es bis zu 1 h).
  const body = guild.client.commands.map((c) => c.data.toJSON());
  try {
    await guild.commands.set(body);
    console.log(`✅ ${body.length} Slash-Commands auf „${guild.name}“ (${guild.id}) registriert`);
  } catch (err) {
    console.error(`❌ Slash-Commands auf „${guild.name}“ (${guild.id}) fehlgeschlagen: ${err.message}`);
    console.error('   → Lade den Bot mit den Scopes "bot" und "applications.commands" neu ein.');
  }

  const config = forGuild(guild.id);
  for (const [section, values] of Object.entries({ channels: config.channels, roles: config.roles })) {
    const missing = Object.keys(values).filter((key) => !values[key]);
    if (missing.length) console.warn(`⚠️  „${guild.name}“ → ${section}: noch nicht eingestellt: ${missing.join(', ')} (/einstellungen)`);
  }

  // Panels nach einem Neustart auf den aktuellen Stand bringen.
  await refreshPanels(guild);
  await appMessages.refreshPanels(guild);
}

module.exports = { setupGuild };
