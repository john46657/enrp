import { community, duty, game, moderation, releases, retention, systemActor, writeAudit, type CoreContext } from '@enrp/core';
import { eq, gameServers, sql } from '@enrp/database';
import { type WorkerEnv } from './env';
import { pruneBackups, runBackup, runRestore, type BackupConfig } from './jobs/backup';
import { announcementMessage, giveawayMessage, pollMessage, suggestionMessage } from './jobs/messages';
import { runWatchdog } from './jobs/watchdog';

type Data = Record<string, unknown>;
export type Processor = (data: Data) => Promise<unknown>;

const str = (v: unknown) => String(v ?? '');

export function createProcessors(ctx: CoreContext, env: WorkerEnv, backupConfig: BackupConfig): Record<string, Record<string, Processor>> {
  const system = systemActor('worker');
  return {
    discord: {
      'role.add': (d) => ctx.discord.addRole(str(d.guildId), str(d.userId), str(d.roleId), str(d.reason)),
      'role.remove': (d) => ctx.discord.removeRole(str(d.guildId), str(d.userId), str(d.roleId), str(d.reason)),
      'message.send': (d) => ctx.discord.sendMessage(str(d.channelId), { content: d.content as string | undefined, embed: d.embed as never }),
      'suggestion.post': async (d) => {
        const { message } = await suggestionMessage(ctx, str(d.suggestionId));
        const sent = await ctx.discord.sendMessage(str(d.channelId), message);
        await community.attachSuggestionMessage(ctx.db, str(d.suggestionId), str(d.channelId), sent.id);
        return sent;
      },
      'suggestion.refresh': async (d) => {
        const { suggestion, message } = await suggestionMessage(ctx, str(d.suggestionId));
        if (suggestion.discordChannelId && suggestion.discordMessageId) await ctx.discord.editMessage(suggestion.discordChannelId, suggestion.discordMessageId, message);
      },
      'poll.post': async (d) => {
        const { poll, message } = await pollMessage(ctx, str(d.pollId));
        if (!poll.discordChannelId) return;
        const sent = await ctx.discord.sendMessage(poll.discordChannelId, message);
        await community.attachPollMessage(ctx.db, poll.id, poll.discordChannelId, sent.id);
      },
      'poll.refresh': async (d) => {
        const { poll, message } = await pollMessage(ctx, str(d.pollId));
        if (poll.discordChannelId && poll.discordMessageId) await ctx.discord.editMessage(poll.discordChannelId, poll.discordMessageId, message);
      },
      'giveaway.post': async (d) => {
        const { giveaway, message } = await giveawayMessage(ctx, str(d.giveawayId));
        if (!giveaway.discordChannelId) return;
        const sent = await ctx.discord.sendMessage(giveaway.discordChannelId, message);
        await community.attachGiveawayMessage(ctx.db, giveaway.id, giveaway.discordChannelId, sent.id);
      },
      'giveaway.result': async (d) => {
        const { giveaway, message } = await giveawayMessage(ctx, str(d.giveawayId));
        if (!giveaway.discordChannelId) return;
        if (giveaway.discordMessageId) await ctx.discord.editMessage(giveaway.discordChannelId, giveaway.discordMessageId, message);
        const winners = giveaway.winners?.length ? giveaway.winners.map((w) => `<@${w}>`).join(', ') : null;
        await ctx.discord.sendMessage(giveaway.discordChannelId, {
          content: winners ? `🎉 Glückwunsch ${winners}! Ihr habt **${giveaway.prize}** gewonnen.` : `Für **${giveaway.prize}** gab es keine gültigen Teilnahmen.`,
        });
      },
      'announcement.post': async (d) => {
        const { message } = await announcementMessage(ctx, str(d.announcementId));
        return ctx.discord.sendMessage(str(d.channelId), message);
      },
    },
    maintenance: {
      'poll.close': (d) => community.closePoll(ctx, system, str(d.pollId)),
      'giveaway.draw': async (d) => {
        try {
          return await community.drawGiveaway(ctx, system, str(d.giveawayId));
        } catch (err) {
          // Bereits manuell gezogen oder abgebrochen – kein Fehler.
          if ((err as { code?: string }).code === 'INVALID_STATE') return { skipped: true };
          throw err;
        }
      },
      'announcement.publish': (d) => community.publishAnnouncement(ctx, system, str(d.announcementId)),
      'release.dispatch': async (d) => dispatchRelease(ctx, env, str(d.releaseId)),
      'health.check': async () => {
        const start = Date.now();
        await ctx.db.execute(sql`select 1`);
        return { databaseMs: Date.now() - start };
      },
      'tick.minute': async () => ({
        duty: await duty.closeStaleDutySessions(ctx),
        staleServers: await game.markStaleServers(ctx, 180),
        moderation: await moderation.expireModerationActions(ctx),
        watchdog: await runWatchdog(ctx),
      }),
      'retention.apply': async () => ({ retention: await retention.applyRetention(ctx), backups: await pruneBackups(ctx, backupConfig) }),
    },
    backups: {
      'backup.run': (d) => runBackup(ctx, backupConfig, { kind: str(d.kind) || 'scheduled', triggeredBy: str(d.triggeredBy) || 'system:scheduler' }),
      'restore.run': (d) => runRestore(ctx, backupConfig, str(d.restoreRequestId)),
    },
    automations: {},
  };
}

/**
 * Stößt die CI/CD-Pipeline für ein freigegebenes Release an (GitHub Actions workflow_dispatch).
 * Es werden keine Befehle auf dem Server ausgeführt. Ohne Konfiguration bleibt das Release „approved“.
 */
async function dispatchRelease(ctx: CoreContext, env: WorkerEnv, releaseId: string) {
  const { release, environmentKey } = await releases.getRelease(ctx.db, releaseId);
  if (release.status !== 'approved') return { skipped: `Status ${release.status}` };
  if (!env.GITHUB_DEPLOY_REPO || !env.GITHUB_DEPLOY_TOKEN) {
    await writeAudit(ctx.db, systemActor('pipeline'), { action: 'release.dispatch_skipped', resourceType: 'release', resourceId: releaseId, metadata: { reason: 'Pipeline nicht konfiguriert' } }, ctx.now());
    return { skipped: 'GITHUB_DEPLOY_REPO/GITHUB_DEPLOY_TOKEN nicht gesetzt' };
  }
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_DEPLOY_REPO}/actions/workflows/${env.GITHUB_DEPLOY_WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.GITHUB_DEPLOY_TOKEN}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'x-github-api-version': '2022-11-28' },
    body: JSON.stringify({ ref: env.GITHUB_DEPLOY_REF, inputs: { version: release.version, environment: environmentKey, release_id: release.id, kind: release.kind } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GitHub workflow_dispatch fehlgeschlagen (${res.status})`);
  await releases.markReleaseResult(ctx, release.id, { status: 'deploying' });
  return { dispatched: true };
}

export async function onlineServerCount(ctx: CoreContext) {
  const rows = await ctx.db.select({ id: gameServers.id }).from(gameServers).where(eq(gameServers.status, 'online'));
  return rows.length;
}

