import { EventEmitter } from 'node:events';
import { type Redis } from 'ioredis';
import { type RealtimePublisher, type RealtimeTopic } from '@enrp/core';

export interface RealtimeMessage {
  topic: RealtimeTopic;
  event: string;
  data: Record<string, unknown>;
  at: string;
}

const CHANNEL = 'enrp:realtime';

/**
 * Verteilt Live-Ereignisse. Mit Redis über Pub/Sub an alle API-Instanzen (und vom Worker aus),
 * ohne Redis nur innerhalb des Prozesses.
 */
export class RealtimeHub implements RealtimePublisher {
  private readonly emitter = new EventEmitter();
  constructor(
    private readonly publisher?: Redis,
    subscriber?: Redis,
  ) {
    this.emitter.setMaxListeners(1000);
    if (subscriber) {
      void subscriber.subscribe(CHANNEL);
      subscriber.on('message', (_channel: string, raw: string) => {
        try {
          this.emitter.emit('message', JSON.parse(raw) as RealtimeMessage);
        } catch {
          /* ungültige Nachricht ignorieren */
        }
      });
    }
  }

  publish(topic: RealtimeTopic, event: string, data: Record<string, unknown>): void {
    const message: RealtimeMessage = { topic, event, data, at: new Date().toISOString() };
    if (this.publisher) void this.publisher.publish(CHANNEL, JSON.stringify(message)).catch(() => {});
    else this.emitter.emit('message', message);
  }

  subscribe(listener: (message: RealtimeMessage) => void): () => void {
    this.emitter.on('message', listener);
    return () => this.emitter.off('message', listener);
  }
}

/** Nur-Senden-Variante für den Worker. */
export class RedisRealtimePublisher implements RealtimePublisher {
  constructor(private readonly redis: Redis) {}
  publish(topic: RealtimeTopic, event: string, data: Record<string, unknown>): void {
    void this.redis.publish(CHANNEL, JSON.stringify({ topic, event, data, at: new Date().toISOString() })).catch(() => {});
  }
}
