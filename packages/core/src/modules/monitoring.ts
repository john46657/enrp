import { desc, jobRuns, serviceHeartbeats, sql, type DbExecutor } from '@enrp/database';

/** Ein Dienst gilt als gesund, wenn sein letztes Lebenszeichen höchstens so alt ist. */
export const HEARTBEAT_STALE_SECONDS = 90;

export async function recordServiceHeartbeat(
  db: DbExecutor,
  input: { service: string; instanceId: string; version?: string; info?: Record<string, unknown>; startedAt?: Date },
  now: Date,
) {
  await db
    .insert(serviceHeartbeats)
    .values({
      service: input.service,
      instanceId: input.instanceId,
      version: input.version ?? null,
      info: input.info ?? null,
      lastSeenAt: now,
      startedAt: input.startedAt ?? now,
    })
    .onConflictDoUpdate({
      target: [serviceHeartbeats.service, serviceHeartbeats.instanceId],
      set: { lastSeenAt: now, version: input.version ?? null, info: input.info ?? null },
    });
}

export async function serviceStatuses(db: DbExecutor, now: Date) {
  const rows = await db
    .select()
    .from(serviceHeartbeats)
    .where(sql`${serviceHeartbeats.lastSeenAt} > ${new Date(now.getTime() - 24 * 3600_000)}`);
  const byService = new Map<string, typeof rows>();
  for (const r of rows) byService.set(r.service, [...(byService.get(r.service) ?? []), r]);
  return ['api', 'bot', 'worker'].map((service) => {
    const instances = (byService.get(service) ?? []).sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
    const latest = instances[0];
    const ageSeconds = latest ? Math.round((now.getTime() - latest.lastSeenAt.getTime()) / 1000) : null;
    return {
      service,
      status: !latest
        ? ('unknown' as const)
        : ageSeconds! <= HEARTBEAT_STALE_SECONDS
          ? ('up' as const)
          : ('down' as const),
      lastSeenAt: latest?.lastSeenAt ?? null,
      ageSeconds,
      version: latest?.version ?? null,
      info: latest?.info ?? null,
      instances: instances.length,
    };
  });
}

export async function recordJobStart(
  db: DbExecutor,
  input: { queue: string; name: string; jobId?: string; attempts: number },
  now: Date,
) {
  const [row] = await db
    .insert(jobRuns)
    .values({ ...input, status: 'running', startedAt: now })
    .returning({ id: jobRuns.id });
  return row!.id;
}

export async function recordJobEnd(
  db: DbExecutor,
  id: string,
  input: { status: 'succeeded' | 'failed'; error?: string; result?: unknown },
  now: Date,
) {
  await db
    .update(jobRuns)
    .set({
      status: input.status,
      error: input.error?.slice(0, 2000) ?? null,
      result: (input.result ?? null) as never,
      finishedAt: now,
    })
    .where(sql`${jobRuns.id} = ${id}`);
}

export async function listJobRuns(db: DbExecutor, filter: { queue?: string; status?: string; limit?: number }) {
  return db
    .select()
    .from(jobRuns)
    .where(
      filter.queue || filter.status
        ? sql`${filter.queue ? sql`${jobRuns.queue} = ${filter.queue}` : sql`true`} and ${filter.status ? sql`${jobRuns.status} = ${filter.status}` : sql`true`}`
        : undefined,
    )
    .orderBy(desc(jobRuns.startedAt))
    .limit(Math.min(filter.limit ?? 50, 200));
}

export async function jobStats(db: DbExecutor, since: Date) {
  const r = await db.execute<{ queue: string; status: string; c: number }>(
    sql`select queue, status, count(*)::int as c from job_runs where started_at >= ${since} group by queue, status order by queue`,
  );
  return r.rows;
}
