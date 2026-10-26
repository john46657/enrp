import { Queue, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_NAMES, type EnqueueOptions, type JobQueue, type QueueName } from '@enrp/core';

export function createRedis(url: string, name: string): Redis {
  // maxRetriesPerRequest: null ist für BullMQ-Worker erforderlich.
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, connectionName: name, lazyConnect: false });
}

export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600, count: 5000 },
} as const;

/** JobQueue-Implementierung auf Basis von BullMQ. */
export class BullJobQueue implements JobQueue {
  private readonly queues = new Map<QueueName, Queue>();
  constructor(private readonly connection: ConnectionOptions) {
    for (const name of QUEUE_NAMES) this.queues.set(name, new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }));
  }

  async enqueue(queue: QueueName, name: string, data: Record<string, unknown>, options: EnqueueOptions = {}): Promise<void> {
    await this.queues.get(queue)!.add(name, data, {
      delay: options.delayMs && options.delayMs > 0 ? options.delayMs : undefined,
      jobId: options.jobId,
      attempts: options.attempts ?? DEFAULT_JOB_OPTIONS.attempts,
    });
  }

  /** Kennzahlen für /ops queue. */
  async counts() {
    const result: Record<string, Record<string, number>> = {};
    for (const [name, q] of this.queues) {
      result[name] = await q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed', 'paused');
    }
    return result;
  }

  async failedJobs(limit = 20) {
    const out: Array<{ queue: string; id: string | undefined; name: string; failedReason: string; attemptsMade: number; timestamp: number }> = [];
    for (const [name, q] of this.queues) {
      for (const job of await q.getFailed(0, limit - 1)) {
        out.push({ queue: name, id: job.id, name: job.name, failedReason: job.failedReason, attemptsMade: job.attemptsMade, timestamp: job.timestamp });
      }
    }
    return out.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  async retry(queue: QueueName, jobId: string) {
    const job = await this.queues.get(queue)?.getJob(jobId);
    if (!job) return false;
    await job.retry();
    return true;
  }

  async close() {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
