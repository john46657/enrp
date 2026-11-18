const API = 'https://apis.roblox.com/cloud/v2/universes';

/**
 * Open Cloud Messaging: weckt alle Spielserver einer Universe (MessagingService:SubscribeAsync im Spiel).
 * Zustellung ist nicht garantiert – Befehle werden trotzdem per Abholen + Bestätigen ausgeliefert.
 * API-Key braucht die Berechtigung universe-messaging-service:publish.
 */
export class RobloxMessagingClient {
  constructor(
    private readonly universeId: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async publish(topic: string, message: string): Promise<void> {
    const res = await this.fetchImpl(`${API}/${encodeURIComponent(this.universeId)}:publishMessage`, {
      method: 'POST',
      headers: { 'x-api-key': this.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ topic, message: message.slice(0, 1024) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Open Cloud Messaging antwortete mit ${res.status}`);
  }
}
