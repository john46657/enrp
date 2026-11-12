// Zeitzonen-Hilfen. Jeder Server hat eine Zeitzone (timezone in config.json / Dashboard, Standard Europe/Berlin).
const DAY_KEYS = { Sun: 'so', Mon: 'mo', Tue: 'di', Wed: 'mi', Thu: 'do', Fri: 'fr', Sat: 'sa' };
const formatters = new Map();
function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }),
    );
  }
  return formatters.get(timeZone);
}

function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

// Datum und Uhrzeit in einer Zeitzone: { year, month, day, hour, minute, second, weekday ('mo' … 'so'), date ('JJJJ-MM-TT'), time ('HH:MM') }
function zonedParts(date, timeZone) {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(date).map((x) => [x.type, x.value]));
  const parts = { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second, weekday: DAY_KEYS[p.weekday] };
  return { ...parts, date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// Ortszeit in einer Zeitzone → Zeitpunkt (ms). Berücksichtigt Sommer-/Winterzeit.
function fromZoned({ year, month, day, hour = 0, minute = 0 }, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let ts = guess;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(ts), timeZone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    ts += guess - shown;
  }
  return ts;
}

const formatDateTime = (ms, timeZone) => new Date(ms).toLocaleString('de-DE', { timeZone, dateStyle: 'medium', timeStyle: 'short' });

// Datumseingaben wie „24.12.2026 18:00“, „24.12.2026“ oder „2026-12-24 18:00“ in einer Zeitzone → Millisekunden.
// Wirft bei ungültiger Eingabe.
function parseLocalDate(text, timeZone = 'Europe/Berlin') {
  const input = String(text).trim();
  const german = input.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?(?:\s*uhr)?$/i);
  const iso = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2}))?$/);
  if (!german && !iso) throw new Error(`„${input}“ verstehe ich nicht. Beispiel: \`24.12.2026 18:00\``);
  const [year, month, day, hour, minute] = (
    german ? [german[3], german[2], german[1], german[4] ?? 0, german[5] ?? 0] : [iso[1], iso[2], iso[3], iso[4] ?? 0, iso[5] ?? 0]
  ).map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || month > 12 || probe.getUTCDate() !== day || hour > 23 || minute > 59) throw new Error(`„${input}“ ist kein gültiges Datum.`);
  return fromZoned({ year, month, day, hour, minute }, timeZone);
}

const formatLocal = (ms, timeZone = 'Europe/Berlin') =>
  new Date(ms).toLocaleString('de-DE', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

module.exports = { isValidTimeZone, zonedParts, fromZoned, formatDateTime, parseLocalDate, formatLocal };
