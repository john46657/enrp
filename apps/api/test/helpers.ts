import { loadConfig, type AppConfig } from '../src/config.js';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...loadConfig({ NODE_ENV: 'test' }), ...overrides };
}
