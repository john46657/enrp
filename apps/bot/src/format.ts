import { EmbedBuilder } from 'discord.js';
import { BRAND } from '@emden-network/shared';

export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h === 0) return `${m} Min.`;
  return `${h} Std. ${m} Min.`;
}

export const ts = (d: Date, style: 'f' | 'R' | 'd' | 't' = 'f') => `<t:${Math.floor(d.getTime() / 1000)}:${style}>`;

export function embed(title: string, description?: string): EmbedBuilder {
  const e = new EmbedBuilder().setColor(BRAND.color).setTitle(title).setFooter({ text: BRAND.name }).setTimestamp(new Date());
  if (description) e.setDescription(description);
  return e;
}

/** Entfernt Massen-Pings aus Nutzereingaben. */
export function sanitize(text: string): string {
  return text.replace(/@(everyone|here)/g, '@​$1');
}

const BERLIN = 'Europe/Berlin';

/**
 * Parst Zeitangaben für Korrekturen: ISO 8601 mit Offset oder "TT.MM.JJJJ HH:MM" bzw. "JJJJ-MM-TT HH:MM"
 * in deutscher Zeit (Europe/Berlin, inkl. Sommerzeit).
 */
export function parseGermanDateTime(input: string): Date | null {
  const s = input.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(s);
  let parts: [number, number, number, number, number] | null = null;
  if (m) parts = [Number(m[3]), Number(m[2]), Number(m[1]), Number(m[4]), Number(m[5])];
  m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})$/.exec(s);
  if (m) parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  if (!parts) return null;
  const [y, mo, d, h, mi] = parts;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  // Offset von Europe/Berlin für diesen Zeitpunkt ermitteln (zweimal, um Umstellungsgrenzen abzufangen)
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i++) guess = Date.UTC(y, mo - 1, d, h, mi) - offsetMs(new Date(guess));
  return new Date(guess);
}

function offsetMs(at: Date): number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: BERLIN, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}
