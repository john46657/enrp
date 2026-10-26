import { randomUUID } from 'node:crypto';
import { MessageFlags, type Interaction, type RepliableInteraction } from 'discord.js';
import { AppError } from '@emden-network/shared';
import { buildActor, CommandContext, type Command, type Services } from './context.js';

export function createInteractionHandler(commands: Command[], services: Services) {
  const byName = new Map(commands.map((c) => [c.data.name, c]));
  const buttons = new Map<string, NonNullable<Command['buttons']>[string]>();
  for (const c of commands) for (const [prefix, fn] of Object.entries(c.buttons ?? {})) buttons.set(prefix, fn);

  return async function onInteraction(i: Interaction): Promise<void> {
    try {
      if (i.isChatInputCommand()) {
        const cmd = byName.get(i.commandName);
        if (!cmd) return;
        const { actor, config } = await buildActor(i, services);
        services.log.info({ command: i.commandName, sub: i.options.getSubcommand(false), user: i.user.id }, 'Command');
        await cmd.execute(new CommandContext(i, actor, config, services));
      } else if (i.isAutocomplete()) {
        await byName.get(i.commandName)?.autocomplete?.(i, services);
      } else if (i.isButton()) {
        const handler = buttons.get(i.customId.split(':')[0]!);
        if (handler) await handler(i, services);
      }
    } catch (err) {
      if (i.isAutocomplete()) {
        await i.respond([]).catch(() => {});
        return;
      }
      await replyError(i as RepliableInteraction, err, services);
    }
  };
}

async function replyError(i: RepliableInteraction, err: unknown, services: Services): Promise<void> {
  let content: string;
  if (err instanceof AppError) {
    content = `❌ ${err.userMessage}`;
    // Fachliche Details nur für den Aufrufer selbst, wenn sie unkritisch sind (Validierungen).
    if (err.code === 'VALIDATION' && err.internalDetail) content += `\n> ${err.internalDetail}`;
    services.log.info({ code: err.code, detail: err.internalDetail, user: i.user.id }, 'Fachlicher Fehler');
  } else {
    const ref = randomUUID().slice(0, 8);
    services.log.error({ ref, err: { message: (err as Error)?.message, stack: (err as Error)?.stack } }, 'Unerwarteter Fehler');
    content = `❌ Ein interner Fehler ist aufgetreten. Referenz: \`${ref}\``;
  }
  const payload = { content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } } as const;
  try {
    if (i.deferred && !i.replied) await i.editReply({ content, allowedMentions: { parse: [] } });
    else if (i.replied) await i.followUp(payload);
    else await i.reply(payload);
  } catch {
    // Interaktion abgelaufen – nichts mehr zu tun.
  }
}
