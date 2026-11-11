// Datumseingaben wie "24.12.2026 18:00" in einer Zeitzone (Standard Europe/Berlin) in Millisekunden umrechnen.
function offsetMinutes(timeZone, date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - date.getTime()) / 60_000);
}

// Versteht "TT.MM.JJJJ", "TT.MM.JJJJ HH:MM" und "JJJJ-MM-TT HH:MM". Wirft bei ungültiger Eingabe.
function parseLocalDate(text, timeZone = 'Europe/Berlin') {
  const input = text.trim();
  const german = input.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?(?:\s*uhr)?$/i);
  const iso = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2}))?$/);
  if (!german && !iso) throw new Error(`„${input}“ verstehe ich nicht. Beispiel: \`24.12.2026 18:00\``);
  const [year, month, day, hour, minute] = (german ? [german[3], german[2], german[1], german[4] ?? 0, german[5] ?? 0] : [iso[1], iso[2], iso[3], iso[4] ?? 0, iso[5] ?? 0]).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) throw new Error(`„${input}“ ist kein gültiges Datum.`);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  // Zweimal annähern, damit auch Tage mit Zeitumstellung stimmen.
  let ms = wall - offsetMinutes(timeZone, new Date(wall)) * 60_000;
  ms = wall - offsetMinutes(timeZone, new Date(ms)) * 60_000;
  return ms;
}

const formatLocal = (ms, timeZone = 'Europe/Berlin') =>
  new Date(ms).toLocaleString('de-DE', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

module.exports = { parseLocalDate, formatLocal };
