import { community, type CoreContext } from '@enrp/core';
import { announcements, eq, giveaways } from '@enrp/database';

/** Baut Discord-Nachrichten für Community-Funktionen. Buttons werden vom Bot ausgewertet. */
const STATUS_LABEL: Record<string, string> = {
  open: 'Offen',
  under_review: 'In Prüfung',
  accepted: 'Angenommen',
  rejected: 'Abgelehnt',
  implemented: 'Umgesetzt',
};

export async function suggestionMessage(ctx: CoreContext, suggestionId: string) {
  const s = await community.getSuggestion(ctx.db, suggestionId);
  const tally = await community.suggestionTally(ctx.db, s.id);
  const open = s.status === 'open' || s.status === 'under_review';
  return {
    suggestion: s,
    message: {
      embed: {
        title: `💡 Vorschlag #${s.number}: ${s.title}`,
        description: `${s.body}\n\n**Status:** ${STATUS_LABEL[s.status] ?? s.status}${s.statusReason ? `\n**Begründung:** ${s.statusReason}` : ''}`,
        color:
          s.status === 'accepted' || s.status === 'implemented'
            ? '#16a34a'
            : s.status === 'rejected'
              ? '#dc2626'
              : '#2563eb',
        fields: [
          { name: '👍 Dafür', value: String(tally.up), inline: true },
          { name: '👎 Dagegen', value: String(tally.down), inline: true },
        ],
        footer: `Von ${s.authorDiscordId === 'deleted' ? 'gelöschtem Konto' : 'einem Community-Mitglied'}`,
      },
      buttons: [
        { customId: `sg:up:${s.id}`, label: 'Dafür', emoji: '👍', style: 'success' as const, disabled: !open },
        { customId: `sg:down:${s.id}`, label: 'Dagegen', emoji: '👎', style: 'danger' as const, disabled: !open },
      ],
    },
  };
}

export async function pollMessage(ctx: CoreContext, pollId: string) {
  const { poll, results, voters } = await community.pollResults(ctx.db, pollId);
  const open = poll.status === 'open';
  return {
    poll,
    message: {
      embed: {
        title: `📊 ${poll.question}`,
        description:
          results
            .map(
              (r) =>
                `**${r.label}** – ${r.votes} Stimme(n)${voters ? ` (${Math.round((r.votes / voters) * 100)} %)` : ''}`,
            )
            .join('\n') +
          `\n\n${voters} Teilnehmende · ${poll.multipleChoice ? 'Mehrfachauswahl' : 'Eine Antwort'}${poll.closesAt ? ` · endet <t:${Math.floor(poll.closesAt.getTime() / 1000)}:R>` : ''}${open ? '' : '\n**Umfrage beendet**'}`,
        color: '#2563eb',
      },
      buttons: poll.options.map((o) => ({
        customId: `poll:${poll.id}:${o.id}`,
        label: o.label,
        style: 'secondary' as const,
        disabled: !open,
      })),
    },
  };
}

export async function giveawayMessage(ctx: CoreContext, giveawayId: string) {
  const [g] = await ctx.db.select().from(giveaways).where(eq(giveaways.id, giveawayId));
  if (!g) throw new Error('Giveaway nicht gefunden');
  const open = g.status === 'open';
  const winners = g.winners?.length ? g.winners.map((w) => `<@${w}>`).join(', ') : 'Keine gültigen Teilnahmen';
  return {
    giveaway: g,
    message: {
      embed: {
        title: `🎁 Giveaway: ${g.prize}`,
        description: `${g.description ? `${g.description}\n\n` : ''}${open ? `Endet <t:${Math.floor(g.endsAt.getTime() / 1000)}:R> · ${g.winnerCount} Gewinner${g.requireVerified ? '\nTeilnahme nur für verifizierte Mitglieder.' : ''}` : g.status === 'drawn' ? `**Gewinner:** ${winners}` : '**Abgebrochen**'}`,
        color: open ? '#f59e0b' : '#64748b',
      },
      buttons: [
        { customId: `gw:enter:${g.id}`, label: 'Teilnehmen', emoji: '🎉', style: 'primary' as const, disabled: !open },
      ],
    },
  };
}

export async function announcementMessage(ctx: CoreContext, announcementId: string) {
  const [a] = await ctx.db.select().from(announcements).where(eq(announcements.id, announcementId));
  if (!a) throw new Error('Ankündigung nicht gefunden');
  const icon = a.kind === 'changelog' ? '📝' : a.kind === 'maintenance' ? '🛠️' : '📢';
  return {
    announcement: a,
    message: {
      embed: {
        title: `${icon} ${a.title}${a.version ? ` (${a.version})` : ''}`,
        description: a.body,
        color: a.kind === 'maintenance' ? '#f59e0b' : '#2563eb',
      },
    },
  };
}
