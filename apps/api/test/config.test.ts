import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('nutzt sichere Standardwerte', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      env: 'development',
      host: '127.0.0.1',
      port: 4000,
      corsOrigins: [],
      trustProxy: false,
    });
  });

  it('bevorzugt API_PORT vor PORT', () => {
    expect(loadConfig({ PORT: '8080' }).port).toBe(8080);
    expect(loadConfig({ PORT: '8080', API_PORT: '5000' }).port).toBe(5000);
  });

  it('liest eine kommagetrennte CORS-Liste', () => {
    expect(loadConfig({ CORS_ORIGINS: 'http://localhost:3000, http://127.0.0.1:3000' }).corsOrigins).toEqual([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ]);
  });

  it.each([
    ['*', /nicht erlaubt/],
    ['kein-url', /keine gültige URL/],
    ['http://localhost:3000/pfad', /reiner Ursprung/],
  ])('lehnt CORS_ORIGINS=%s ab', (value, message) => {
    expect(() => loadConfig({ CORS_ORIGINS: value })).toThrow(message);
  });

  it('verlangt HTTPS-Ursprünge in Produktion', () => {
    const prod = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://app@db.internal:5432/emden',
      DASHBOARD_PUBLIC_URL: 'https://cc.example.org',
    };
    expect(() => loadConfig({ ...prod, CORS_ORIGINS: 'http://example.org' })).toThrow(/HTTPS/);
    expect(loadConfig({ ...prod, CORS_ORIGINS: 'https://example.org' }).corsOrigins).toEqual([
      'https://example.org',
    ]);
  });

  it('meldet ungültige Werte mit Variablennamen, ohne den Wert zu verraten', () => {
    try {
      loadConfig({ API_PORT: 'geheim123' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toContain('API_PORT');
      expect((err as Error).message).not.toContain('geheim123');
    }
  });

  it('versteht TRUST_PROXY als Boolean', () => {
    expect(loadConfig({ TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ TRUST_PROXY: '0' }).trustProxy).toBe(false);
    expect(() => loadConfig({ TRUST_PROXY: 'ja' })).toThrow(ConfigError);
  });

  describe('Datenbank', () => {
    it('nutzt ohne DATABASE_URL in der Entwicklung die lokale PGlite-Datenbank unter apps/api/.data', () => {
      const { database } = loadConfig({});
      expect(database.kind).toBe('pglite');
      expect(database.kind === 'pglite' && database.dataDir).toMatch(/apps[\\/]api[\\/]\.data[\\/]pglite$/);
    });

    it('nutzt in Tests eine Datenbank nur im Arbeitsspeicher', () => {
      expect(loadConfig({ NODE_ENV: 'test' }).database).toEqual({ kind: 'pglite', dataDir: null });
    });

    it('verwendet PostgreSQL, wenn DATABASE_URL gesetzt ist', () => {
      expect(loadConfig({ DATABASE_URL: ' postgresql://u@localhost/emden ' }).database).toEqual({
        kind: 'postgres',
        url: 'postgresql://u@localhost/emden',
      });
    });

    it('verlangt in Produktion eine echte PostgreSQL-Datenbank', () => {
      expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(
        /DATABASE_URL: in Produktion erforderlich/,
      );
    });

    it('lehnt ungültige URLs ab, ohne Passwörter in der Meldung zu zeigen', () => {
      for (const url of ['geheim:passwort@kaputt', 'mysql://u:passwort@host/db']) {
        try {
          loadConfig({ DATABASE_URL: url });
          expect.unreachable();
        } catch (err) {
          expect(err).toBeInstanceOf(ConfigError);
          expect((err as Error).message).toContain('DATABASE_URL');
          expect((err as Error).message).not.toContain('passwort');
        }
      }
    });
  });

  describe('Anmeldung und Sitzungen', () => {
    const ID = '222222222222222222';
    const SECRET = 'einGeheimesSecret-1234567890';

    it('hat sichere Standardwerte', () => {
      const config = loadConfig({});
      expect(config).toMatchObject({
        dashboardOrigin: 'http://127.0.0.1:3000',
        discord: null,
        ownerDiscordUserId: null,
        session: { idleMinutes: 240, maxHours: 24 },
        auditRetentionDays: 365,
      });
    });

    it('behandelt leere Werte aus der .env wie "nicht gesetzt"', () => {
      expect(
        loadConfig({ DISCORD_CLIENT_ID: '', DISCORD_CLIENT_SECRET: ' ', OWNER_DISCORD_USER_ID: '' }),
      ).toMatchObject({
        discord: null,
        ownerDiscordUserId: null,
      });
    });

    it('übernimmt eine vollständige Discord-Konfiguration', () => {
      expect(loadConfig({ DISCORD_CLIENT_ID: ID, DISCORD_CLIENT_SECRET: SECRET }).discord).toEqual({
        clientId: ID,
        clientSecret: SECRET,
        baseUrl: 'https://discord.com',
      });
    });

    it.each([
      [{ DISCORD_CLIENT_ID: ID }, /beide setzen/],
      [{ DISCORD_CLIENT_SECRET: SECRET }, /beide setzen/],
      [{ DISCORD_CLIENT_ID: 'meine-app', DISCORD_CLIENT_SECRET: SECRET }, /17–20 Ziffern/],
      [{ DISCORD_CLIENT_ID: ID, DISCORD_CLIENT_SECRET: 'zu kurz' }, /Client Secret/],
      [{ OWNER_DISCORD_USER_ID: '@john' }, /OWNER_DISCORD_USER_ID/],
      [{ DASHBOARD_PUBLIC_URL: 'http://127.0.0.1:3000/pfad' }, /ohne Pfad/],
      [{ SESSION_IDLE_MINUTES: '1' }, /SESSION_IDLE_MINUTES/],
    ])('lehnt ungültige Werte ab: %o', (env, message) => {
      expect(() => loadConfig(env)).toThrow(message);
    });

    it('zeigt ein falsches Client Secret niemals in der Fehlermeldung', () => {
      const leaked = 'geheim mit leerzeichen 123456';
      expect(() => loadConfig({ DISCORD_CLIENT_ID: ID, DISCORD_CLIENT_SECRET: leaked })).toThrow(ConfigError);
      try {
        loadConfig({ DISCORD_CLIENT_ID: ID, DISCORD_CLIENT_SECRET: leaked });
      } catch (err) {
        expect((err as Error).message).not.toContain('geheim');
      }
    });

    it('stellt in Produktion strenge Anforderungen', () => {
      const prod = { NODE_ENV: 'production', DATABASE_URL: 'postgres://app@db/emden' };
      expect(() => loadConfig(prod)).toThrow(/DASHBOARD_PUBLIC_URL: in Produktion erforderlich/);
      expect(() => loadConfig({ ...prod, DASHBOARD_PUBLIC_URL: 'http://cc.example.org' })).toThrow(/HTTPS/);
      expect(() =>
        loadConfig({
          ...prod,
          DASHBOARD_PUBLIC_URL: 'https://cc.example.org',
          DISCORD_OAUTH_BASE_URL: 'http://fake',
        }),
      ).toThrow(/nur für Tests/);
      expect(loadConfig({ ...prod, DASHBOARD_PUBLIC_URL: 'https://cc.example.org/' }).dashboardOrigin).toBe(
        'https://cc.example.org',
      );
    });
  });
});
