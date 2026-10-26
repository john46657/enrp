import type { Pool, Queryable } from '@emden-network/database';
import { writeAudit } from './audit.js';

export interface OutboxEvent<P = unknown> {
  id: string;
  type: string;
  payload: P;
  attempts: number;
  maxAttempts: number;
}

export async function enqueueOutbox(
  db: Queryable,
  type: string,
  payload: unknown,
  opts: { dedupeKey?: string; maxAttempts?: number } = {},
): Promise<void> {
  // Ein noch offenes Event mit gleichem dedupe_key wird nicht doppelt angelegt.
  await db.query(
    `INSERT INTO outbox_events (type, payload, dedupe_key, max_attempts)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'processing') DO NOTHING`,
    [type, JSON.stringify(payload), opts.dedupeKey ?? null, opts.maxAttempts ?? 8],
  );
}

/** Fehler, bei dem Wiederholen sinnlos ist (z. B. Mitglied nicht mehr auf dem Server). */
export class PermanentError extends Error {
  override name = 'PermanentError';
}

export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

export interface OutboxProcessorOptions {
  batchSize?: number;
  lockSeconds?: number;
  /** Basis für exponentielles Backoff in Sekunden. */
  backoffBaseSeconds?: number;
  maxBackoffSeconds?: number;
  onError?: (event: OutboxEvent, err: unknown, final: boolean) => void;
}

export class OutboxProcessor {
  private readonly handlers = new Map<string, OutboxHandler>();
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly pool: Pool,
    private readonly opts: OutboxProcessorOptions = {},
  ) {}

  on(type: string, handler: OutboxHandler): this {
    this.handlers.set(type, handler);
    return this;
  }

  /** Holt fällige Events (mit Sperre, mehrere Worker-sicher) und verarbeitet sie. Liefert die Anzahl. */
  async runOnce(): Promise<number> {
    const types = [...this.handlers.keys()];
    if (types.length === 0) return 0;
    const { rows } = await this.pool.query<{ id: string; type: string; payload: unknown; attempts: number; max_attempts: number }>(
      `UPDATE outbox_events SET status = 'processing', attempts = attempts + 1, locked_until = now() + make_interval(secs => $2)
       WHERE id IN (
         SELECT id FROM outbox_events
         WHERE type = ANY($3)
           AND ((status = 'pending' AND available_at <= now()) OR (status = 'processing' AND locked_until < now()))
         ORDER BY available_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED)
       RETURNING id, type, payload, attempts, max_attempts`,
      [this.opts.batchSize ?? 10, this.opts.lockSeconds ?? 60, types],
    );
    for (const row of rows) {
      const event: OutboxEvent = { id: row.id, type: row.type, payload: row.payload, attempts: row.attempts, maxAttempts: row.max_attempts };
      await this.process(event);
    }
    return rows.length;
  }

  private async process(event: OutboxEvent): Promise<void> {
    const handler = this.handlers.get(event.type)!;
    try {
      await handler(event);
      await this.pool.query(`UPDATE outbox_events SET status = 'done', processed_at = now(), locked_until = NULL, last_error = NULL WHERE id = $1`, [event.id]);
    } catch (err) {
      const final = err instanceof PermanentError || event.attempts >= event.maxAttempts;
      const message = err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 500) : 'unbekannter Fehler';
      this.opts.onError?.(event, err, final);
      if (final) {
        await this.pool.query(
          `UPDATE outbox_events SET status = 'failed', processed_at = now(), locked_until = NULL, last_error = $2 WHERE id = $1`,
          [event.id, message],
        );
        await writeAudit(this.pool, {
          actorType: 'system',
          action: 'outbox.failed',
          targetType: 'outbox_event',
          targetId: event.id,
          outcome: 'failure',
          reason: message,
          metadata: { type: event.type, attempts: event.attempts },
        });
      } else {
        const base = this.opts.backoffBaseSeconds ?? 5;
        const delay = Math.min(base * 2 ** (event.attempts - 1), this.opts.maxBackoffSeconds ?? 3600);
        await this.pool.query(
          `UPDATE outbox_events SET status = 'pending', locked_until = NULL, last_error = $2, available_at = now() + make_interval(secs => $3) WHERE id = $1`,
          [event.id, message, delay],
        );
      }
    }
  }

  start(intervalMs = 2000): void {
    if (this.timer) return;
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        while ((await this.runOnce()) > 0) {
          /* Rückstau abarbeiten */
        }
      } catch (err) {
        this.opts.onError?.({ id: '-', type: '-', payload: null, attempts: 0, maxAttempts: 0 }, err, false);
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(() => void tick(), intervalMs);
    void tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
