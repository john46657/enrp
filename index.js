require('dotenv').config();
require('./src/lib/settings'); // in Discord geänderte Einstellungen über config.json legen
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits, Partials, InteractionContextType } = require('discord.js');

if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN fehlt. Lege eine .env-Datei an (siehe .env.example).');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // privilegiert: Willkommen & Auto-Rolle
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privilegiert: Ticket-Transkripte
  ],
  partials: [Partials.GuildMember],
});

client.commands = new Collection();
client.components = new Collection();

// Jede Datei in src/commands/** exportiert { data, execute, components? }.
function loadCommands(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      loadCommands(full);
      continue;
    }
    if (!entry.name.endsWith('.js')) continue;
    const command = require(full);
    command.data.setContexts(InteractionContextType.Guild);
    client.commands.set(command.data.name, command);
    // Buttons, Menüs und Modals werden über das Präfix der customId ("präfix:...") zugeordnet.
    for (const [prefix, handler] of Object.entries(command.components ?? {})) {
      client.components.set(prefix, handler);
    }
  }
}

loadCommands(path.join(__dirname, 'src', 'commands'));

for (const file of fs.readdirSync(path.join(__dirname, 'src', 'events'))) {
  const event = require(path.join(__dirname, 'src', 'events', file));
  client[event.once ? 'once' : 'on'](event.name, (...args) =>
    Promise.resolve(event.execute(...args, client)).catch((err) => console.error(`[event:${event.name}]`, err)),
  );
}

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error(`❌ Login fehlgeschlagen: ${err.message}`);
  if (err.code === 'TokenInvalid') console.error('   → Prüfe DISCORD_TOKEN in der .env-Datei.');
  if (/disallowed intents/i.test(err.message)) {
    console.error('   → Aktiviere im Developer Portal unter "Bot" die Privileged Intents "Server Members" und "Message Content".');
  }
  process.exit(1);
});
