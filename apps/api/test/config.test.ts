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
    expect(() => loadConfig({ NODE_ENV: 'production', CORS_ORIGINS: 'http://example.org' })).toThrow(/HTTPS/);
    expect(loadConfig({ NODE_ENV: 'production', CORS_ORIGINS: 'https://example.org' }).corsOrigins).toEqual([
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
});
