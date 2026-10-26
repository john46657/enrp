import { InteractionContextType } from 'discord.js';
import type { Command } from '../context.js';
import { playerCommands } from './player.js';
import { faction } from './faction.js';
import { duty } from './duty.js';
import { serverCommands } from './server.js';
import { system } from './system.js';

export const commands: Command[] = [...playerCommands, faction, duty, ...serverCommands, system];

// Alle Commands nur auf dem Server, nie in DMs. Die Sichtbarkeit in Discord ist kein Zugriffsschutz –
// jede Berechtigung wird bei der Ausführung serverseitig geprüft.
for (const c of commands) {
  (c.data as unknown as { setContexts(...ctx: InteractionContextType[]): unknown }).setContexts(InteractionContextType.Guild);
}
