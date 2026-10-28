// Provider für die TikTok-LIVE-Erkennung.
//
// Stand der Prüfung (Oktober 2026): TikToks offizielle Developer-APIs (Login Kit, Display API mit den Scopes
// user.info.basic und video.list, Content Posting API) liefern KEINEN Live-Status. Inoffizielle Wege (Scraping,
// nachgebaute Web-Schnittstellen) werden hier bewusst nicht verwendet. Deshalb:
//
//   none     – keine automatische Erkennung; nur manuelle Ankündigungen (/tiktok-live announce). Standard.
//   webhook  – ein externer, für TikTok-LIVE-Daten autorisierter Dienst meldet den Status per HTTPS an
//              POST /api/tiktok/webhook (Dashboard-Server) mit dem Header „Authorization: Bearer TIKTOK_WEBHOOK_SECRET“.
//
// Schnittstelle eines Providers:
//   name, label
//   status()  → { connected: boolean, detail: string }
//   check(usernames) → Map<username, { status: 'live' | 'offline' | 'unknown', url?, title?, error? }>
//     „unknown“ heißt: kein verlässlicher Wert – der gespeicherte Status bleibt dann unverändert.

const STALE_AFTER = 10 * 60_000; // Webhook-Meldungen gelten 10 Minuten

const none = {
  name: 'none',
  label: 'Keine automatische Erkennung',
  status: () => ({ connected: false, detail: 'Keine offizielle TikTok-Schnittstelle für den Live-Status verfügbar – nur manuelle Ankündigungen.' }),
  async check(usernames) {
    return new Map(usernames.map((u) => [u, { status: 'unknown', error: 'Kein Provider verbunden' }]));
  },
};

// Letzte Meldungen des Webhooks: username → { status, url, title, at }
const reports = new Map();
let lastReportAt = null;

const webhook = {
  name: 'webhook',
  label: 'Webhook (externer, autorisierter Dienst)',
  status() {
    if (!process.env.TIKTOK_WEBHOOK_SECRET) return { connected: false, detail: 'TIKTOK_WEBHOOK_SECRET fehlt in der .env.' };
    if (!lastReportAt) return { connected: false, detail: 'Eingerichtet, aber noch keine Meldung empfangen.' };
    const age = Date.now() - lastReportAt;
    return age < STALE_AFTER
      ? { connected: true, detail: `Letzte Meldung vor ${Math.round(age / 1000)} s.` }
      : { connected: false, detail: `Seit ${Math.round(age / 60_000)} Min. keine Meldung – Status gilt als unbekannt.` };
  },
  async check(usernames, now = Date.now()) {
    return new Map(
      usernames.map((u) => {
        const report = reports.get(u);
        if (!report) return [u, { status: 'unknown', error: 'Keine Meldung für diesen Creator' }];
        if (now - report.at > STALE_AFTER) return [u, { status: 'unknown', error: 'Letzte Meldung ist veraltet' }];
        return [u, { status: report.status, url: report.url, title: report.title }];
      }),
    );
  },
  // Vom Webhook-Endpunkt aufgerufen (Eingaben sind dort bereits geprüft).
  report({ username, status, url, title }, now = Date.now()) {
    reports.set(username, { status, url, title, at: now });
    lastReportAt = now;
  },
  reset() {
    reports.clear();
    lastReportAt = null;
  },
};

const PROVIDERS = { none, webhook };
const providerFor = (name) => PROVIDERS[name] ?? none;

module.exports = { PROVIDERS, providerFor, STALE_AFTER };
