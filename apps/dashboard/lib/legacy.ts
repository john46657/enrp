'use client';

import { useQuery } from '@tanstack/react-query';
import { get, post, put } from './api';

/** Altmodule des Bots (Bewerbungen, Level, Rollenpanel, Ticketpanel, Einstellungen): der Bot beantwortet die Anfragen. */

export interface LegacyChannel {
  id: string;
  name: string;
  /** Discord-Kanaltyp: 0 Text, 2 Sprache, 4 Kategorie, 5 Ankündigung */
  type: number;
  parentId: string | null;
}
export interface LegacyRole {
  id: string;
  name: string;
  color: string;
  managed: boolean;
  editable: boolean;
}
export type LegacyConfig = Record<string, unknown>;
export interface LegacyGuild {
  guild: { id: string; name: string; icon: string | null; memberCount: number };
  config: LegacyConfig;
  /** Anzahl der Einstellungen, die von der config.json abweichen. */
  changed: number;
  channels: LegacyChannel[];
  roles: LegacyRole[];
  questionTypes: Record<string, string> | string[];
  ticketPanels: number;
}
export interface LegacyChange {
  path: string;
  value: unknown;
}

export const legacyKey = (name: string) => ['legacy', name];

export function useLegacyLive<T>(name: string, options: { refetchInterval?: number; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: legacyKey(name),
    queryFn: async () => (await get<{ data: T }>(`/legacy/live/${name}`)).data,
    retry: false,
    ...options,
  });
}
export const useLegacyGuild = () => useLegacyLive<LegacyGuild>('guild');

export const legacyAction = <T = unknown>(name: string, body: Record<string, unknown> = {}) =>
  post<{ result: T }>(`/legacy/actions/${name}`, body).then((r) => r.result);
export const saveLegacySettings = (changes: LegacyChange[]) =>
  put<{ changed: number }>('/legacy/settings', { changes });
export const resetLegacySettings = () => post<{ changed: number }>('/legacy/settings/reset');

/** Wert an einem Pfad wie "tickets.types.general.capacity" (in Listen wird per id gesucht – wie beim Bot). */
export function readPath(root: unknown, path: string): unknown {
  let target: unknown = root;
  for (const key of path.split('.')) {
    if (Array.isArray(target)) target = target.find((entry: { id?: string }) => entry?.id === key);
    else if (target && typeof target === 'object') target = (target as Record<string, unknown>)[key];
    else return undefined;
  }
  return target;
}

const DAY_ORDER = ['mo', 'di', 'mi', 'do', 'fr', 'sa', 'so'];
export interface Period {
  days: string[];
  from: string;
  to: string;
}
export const formatPeriods = (periods: Period[]) =>
  periods.map((p) => `${p.days.join(',')} ${p.from}-${p.to}`).join('; ');

/** "mo-fr 15:00-23:00; sa,so 12:00-24:00" → Zeiträume (gleiches Format wie /einstellungen oeffnungszeiten). */
export function parsePeriods(text: string): Period[] {
  if (!text.trim()) return [];
  return text.split(';').map((part) => {
    const match = part
      .trim()
      .toLowerCase()
      .match(/^([a-z,\s-]+?)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
    if (!match) throw new Error(`„${part.trim()}“ verstehe ich nicht. Beispiel: mo-fr 15:00-23:00; sa,so 12:00-24:00`);
    const days: string[] = [];
    for (const token of match[1]!
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)) {
      const [start, end = start] = token.split('-').map((t) => t.trim());
      const a = DAY_ORDER.indexOf(start!);
      const b = DAY_ORDER.indexOf(end!);
      if (a < 0 || b < 0 || b < a) throw new Error(`Unbekannte Tage „${token}“. Erlaubt: ${DAY_ORDER.join(', ')}`);
      days.push(...DAY_ORDER.slice(a, b + 1));
    }
    const [from, to] = [match[2]!, match[3]!].map((t) => t.padStart(5, '0')) as [string, string];
    for (const time of [from, to]) {
      const [h, m] = time.split(':').map(Number) as [number, number];
      if (h > 24 || m > 59 || (h === 24 && m > 0)) throw new Error(`Ungültige Uhrzeit „${time}“`);
    }
    return { days: [...new Set(days)], from, to };
  });
}

export const fmtMillis = (ms: number | null | undefined) =>
  ms ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms)) : '–';
