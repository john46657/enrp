/** Formatiert Sekunden als "12 Std. 5 Min." */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days} T.`);
  if (hours) parts.push(`${hours} Std.`);
  if (minutes || !parts.length) parts.push(`${minutes} Min.`);
  return parts.join(' ');
}

/** Parst Dauerangaben wie "30m", "2h", "7d", "1w" in Sekunden. */
export function parseDuration(input: string): number | null {
  const match = /^\s*(\d{1,5})\s*([smhdw])\s*$/i.exec(input);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  const factor = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[unit]!;
  return value * factor;
}

export function formatDateTime(date: Date | string | null | undefined, timeZone = 'Europe/Berlin'): string {
  if (!date) return '–';
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(d);
}
