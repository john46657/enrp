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

module.exports = { isValidTimeZone, zonedParts, fromZoned, formatDateTime };
