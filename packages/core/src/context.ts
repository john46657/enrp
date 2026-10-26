import { type Logger } from '@enrp/config';
import { type Database, type DbExecutor } from '@enrp/database';

export const QUEUE_NAMES = ['discord', 'maintenance', 'backups', 'automations'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export interface EnqueueOptions {
  delayMs?: number;
  /** Gleiche jobId = Job wird nicht doppelt angelegt. */
  jobId?: string;
  attempts?: number;
}

/** Abstraktion der Hintergrund-Warteschlange (BullMQ in Betrieb, In-Memory in Tests). */
export interface JobQueue {
  enqueue(queue: QueueName, name: string, data: Record<string, unknown>, options?: EnqueueOptions): Promise<void>;
}

export const REALTIME_TOPICS = ['servers', 'tickets', 'reports', 'alerts', 'jobs', 'incidents', 'approvals'] as const;
export type RealtimeTopic = (typeof REALTIME_TOPICS)[number];

/** Live-Ereignisse für das Dashboard (SSE). */
export interface RealtimePublisher {
  publish(topic: RealtimeTopic, event: string, data: Record<string, unknown>): void;
}

export interface CoreConfig {
  /** Discord-IDs mit Vollzugriff (Notfallzugang, Ersteinrichtung). */
  ownerDiscordIds: string[];
  /** Geheimnis für HMAC (Code-Hashes, IP-Hashes). */
  hashSecret: string;
  guildId?: string;
  verifiedRoleId?: string;
  appEnv: 'development' | 'staging' | 'production';
}

export interface DiscordMemberInfo {
  id: string;
  username: string;
  globalName: string | null;
  avatarHash: string | null;
  roleIds: string[];
}

export interface DiscordEmbedInput {
  title?: string;
  description?: string;
  color?: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: string;
  url?: string;
}

/**
 * Discord-REST-Zugriff (Bot-Token). Wird von API und Worker genutzt; in Tests durch eine Attrappe ersetzt.
 * Alle Methoden werfen bei Fehlern einen Error mit verständlicher Nachricht.
 */
export interface DiscordGateway {
  readonly configured: boolean;
  getMember(guildId: string, userId: string): Promise<DiscordMemberInfo | null>;
  addRole(guildId: string, userId: string, roleId: string, reason: string): Promise<void>;
  removeRole(guildId: string, userId: string, roleId: string, reason: string): Promise<void>;
  timeout(guildId: string, userId: string, until: Date | null, reason: string): Promise<void>;
  kick(guildId: string, userId: string, reason: string): Promise<void>;
  ban(guildId: string, userId: string, reason: string, deleteMessageSeconds?: number): Promise<void>;
  unban(guildId: string, userId: string, reason: string): Promise<void>;
  sendMessage(channelId: string, payload: { content?: string; embed?: DiscordEmbedInput }): Promise<{ id: string }>;
  sendDirectMessage(userId: string, payload: { content?: string; embed?: DiscordEmbedInput }): Promise<boolean>;
}

export class NotConfiguredDiscordGateway implements DiscordGateway {
  readonly configured = false;
  private fail(): never {
    throw new Error('Discord-Integration ist nicht konfiguriert (DISCORD_BOT_TOKEN fehlt).');
  }
  getMember = async (): Promise<DiscordMemberInfo | null> => this.fail();
  addRole = async () => this.fail();
  removeRole = async () => this.fail();
  timeout = async () => this.fail();
  kick = async () => this.fail();
  ban = async () => this.fail();
  unban = async () => this.fail();
  sendMessage = async (): Promise<{ id: string }> => this.fail();
  sendDirectMessage = async (): Promise<boolean> => this.fail();
}

export interface CoreContext {
  db: Database;
  discord: DiscordGateway;
  now: () => Date;
  queue: JobQueue;
  realtime: RealtimePublisher;
  logger: Logger;
  config: CoreConfig;
}

/** Kontext innerhalb einer Transaktion. */
export interface TxContext extends Omit<CoreContext, 'db'> {
  db: DbExecutor;
}

export const noopRealtime: RealtimePublisher = { publish: () => {} };

export class MemoryQueue implements JobQueue {
  readonly jobs: Array<{ queue: QueueName; name: string; data: Record<string, unknown>; options?: EnqueueOptions }> = [];
  async enqueue(queue: QueueName, name: string, data: Record<string, unknown>, options?: EnqueueOptions): Promise<void> {
    if (options?.jobId && this.jobs.some((j) => j.options?.jobId === options.jobId)) return;
    this.jobs.push({ queue, name, data, options });
  }
  take(name?: string) {
    const matched = this.jobs.filter((j) => !name || j.name === name);
    for (const job of matched) this.jobs.splice(this.jobs.indexOf(job), 1);
    return matched;
  }
}
