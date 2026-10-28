import { describe, expect, it } from 'vitest';
import { classifyServerType } from './game';

describe('Servertyp-Erkennung', () => {
  it('ohne PrivateServerId ist der Server öffentlich', () => {
    expect(classifyServerType({})).toBe('public');
    expect(classifyServerType({ privateServerId: '', privateServerOwnerId: 0 })).toBe('public');
  });
  it('mit Besitzer ist der Server privat', () => {
    expect(classifyServerType({ privateServerId: 'abc', privateServerOwnerId: 42 })).toBe('private');
  });
  it('ohne Besitzer ist der Server reserviert', () => {
    expect(classifyServerType({ privateServerId: 'abc', privateServerOwnerId: 0 })).toBe('reserved');
    expect(classifyServerType({ privateServerId: 'abc' })).toBe('reserved');
  });
});
