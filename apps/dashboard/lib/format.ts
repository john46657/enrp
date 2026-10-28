const timeFormat = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: 'Europe/Berlin',
});

export function formatDateTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

export function formatUptime(seconds: number): string {
  const s = Math.floor(seconds);
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days} T ${hours} Std`;
  if (hours > 0) return `${hours} Std ${minutes} Min`;
  if (minutes > 0) return `${minutes} Min`;
  return `${s} Sek`;
}
