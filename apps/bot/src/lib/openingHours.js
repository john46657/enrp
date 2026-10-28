const DAYS = ['so', 'mo', 'di', 'mi', 'do', 'fr', 'sa'];
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const formatters = new Map();
function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  }
  return formatters.get(timeZone);
}

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// Wochentag und Uhrzeit (in Minuten) in der eingestellten Zeitzone.
function localTime(timeZone, date) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(date).map((p) => [p.type, p.value]));
  return { day: WEEKDAY_INDEX[parts.weekday], minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

// openingHours = tickets.openingHours eines Servers.
function isOpen(openingHours, date = new Date()) {
  if (!openingHours.enabled) return true;
  const { day, minutes } = localTime(openingHours.timezone, date);
  return openingHours.periods.some((period) => {
    const from = toMinutes(period.from);
    const to = toMinutes(period.to);
    const days = period.days.map((d) => DAYS.indexOf(d.toLowerCase()));
    if (from < to) return days.includes(day) && minutes >= from && minutes < to;
    // Über Mitternacht, z. B. 20:00–02:00
    const previousDay = (day + 6) % 7;
    return (days.includes(day) && minutes >= from) || (days.includes(previousDay) && minutes < to);
  });
}

// Nächster Zeitpunkt, ab dem das Team wieder erreichbar ist (auf die Minute genau, max. 8 Tage voraus).
function nextOpening(openingHours, date = new Date()) {
  if (!openingHours.enabled) return null;
  const start = Math.ceil(date.getTime() / 60_000) * 60_000;
  for (let t = start; t < start + 8 * 24 * 60 * 60_000; t += 60_000) {
    if (isOpen(openingHours, new Date(t))) return new Date(t);
  }
  return null;
}

module.exports = { isOpen, nextOpening };
