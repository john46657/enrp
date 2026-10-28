import { sql, type DbExecutor } from '@enrp/database';

/** Stunden und Wochentage werden in deutscher Zeit ausgewertet. */
export const STATS_TIME_ZONE = 'Europe/Berlin';

/** Höchstens so viele Stunden werden als Verlauf geliefert (90 Tage). */
const MAX_HOURS = 90 * 24;

/**
 * Spieleraktivität aus den Spielsessions: unterschiedliche Spieler je Stunde und die durchschnittliche
 * Auslastung je Wochentag und Uhrzeit (Spitzenzeiten).
 */
export async function playerActivity(db: DbExecutor, since: Date, now: Date) {
  const from = new Date(Math.max(since.getTime(), now.getTime() - MAX_HOURS * 3600_000));
  const hourly = await db.execute<{ hour: Date; players: number }>(sql`
    select h as hour, count(distinct s.roblox_user_id)::int as players
    from generate_series(date_trunc('hour', ${from}::timestamptz), date_trunc('hour', ${now}::timestamptz), interval '1 hour') h
    left join play_sessions s
      on s.joined_at < h + interval '1 hour' and coalesce(s.left_at, ${now}::timestamptz) > h
    group by h order by h`);
  // Durchschnitt je Wochentag/Stunde (ISO: 1 = Montag) in deutscher Zeit; leere Stunden zählen mit 0.
  const peaks = await db.execute<{ weekday: number; hour: number; avg_players: number }>(sql`
    with hours as (
      select h, count(distinct s.roblox_user_id) as players
      from generate_series(date_trunc('hour', ${from}::timestamptz), date_trunc('hour', ${now}::timestamptz), interval '1 hour') h
      left join play_sessions s
        on s.joined_at < h + interval '1 hour' and coalesce(s.left_at, ${now}::timestamptz) > h
      group by h
    )
    select extract(isodow from h at time zone ${STATS_TIME_ZONE})::int as weekday,
      extract(hour from h at time zone ${STATS_TIME_ZONE})::int as hour,
      round(avg(players), 1)::float as avg_players
    from hours group by 1, 2 order by 1, 2`);
  const [totals] = (
    await db.execute<{ unique_players: number; sessions: number; play_seconds: number }>(sql`
      select count(distinct roblox_user_id)::int as unique_players, count(*)::int as sessions,
        coalesce(sum(extract(epoch from (coalesce(left_at, ${now}::timestamptz) - greatest(joined_at, ${from}::timestamptz)))), 0)::bigint as play_seconds
      from play_sessions where coalesce(left_at, ${now}::timestamptz) > ${from}::timestamptz`)
  ).rows;
  const hourlyItems = hourly.rows.map((r) => ({ hour: new Date(r.hour).toISOString(), players: r.players }));
  const peak = hourlyItems.reduce<{ hour: string; players: number } | null>(
    (best, h) => (!best || h.players > best.players ? h : best),
    null,
  );
  return {
    from: from.toISOString(),
    hourly: hourlyItems,
    peaks: peaks.rows.map((r) => ({ weekday: r.weekday, hour: r.hour, avgPlayers: Number(r.avg_players) })),
    peak: peak && peak.players > 0 ? peak : null,
    uniquePlayers: totals?.unique_players ?? 0,
    sessions: totals?.sessions ?? 0,
    playSeconds: Number(totals?.play_seconds ?? 0),
  };
}

/** Moderationsaktionen im Zeitraum nach Art und Plattform. */
export async function moderationCounts(db: DbExecutor, since: Date) {
  const rows = await db.execute<{ type: string; platform: string; count: number }>(sql`
    select type::text, platform::text, count(*)::int as count from moderation_actions
    where created_at >= ${since}::timestamptz group by 1, 2 order by 3 desc`);
  return rows.rows;
}

/** Tickets im Zeitraum: eröffnet, geschlossen, offen sowie Bearbeitungsdauer bis zum Schließen. */
export async function ticketTimes(db: DbExecutor, since: Date) {
  const [row] = (
    await db.execute<{
      opened: number;
      closed: number;
      open_now: number;
      avg_seconds: number | null;
      median_seconds: number | null;
    }>(sql`
      select
        (select count(*)::int from tickets where created_at >= ${since}::timestamptz) as opened,
        (select count(*)::int from tickets where closed_at >= ${since}::timestamptz) as closed,
        (select count(*)::int from tickets where closed_at is null) as open_now,
        (select avg(extract(epoch from closed_at - created_at))::float from tickets
          where closed_at >= ${since}::timestamptz) as avg_seconds,
        (select percentile_cont(0.5) within group (order by extract(epoch from closed_at - created_at))::float
          from tickets where closed_at >= ${since}::timestamptz) as median_seconds`)
  ).rows;
  return {
    opened: row?.opened ?? 0,
    closed: row?.closed ?? 0,
    openNow: row?.open_now ?? 0,
    avgCloseSeconds: row?.avg_seconds === null || row?.avg_seconds === undefined ? null : Math.round(row.avg_seconds),
    medianCloseSeconds:
      row?.median_seconds === null || row?.median_seconds === undefined ? null : Math.round(row.median_seconds),
  };
}
