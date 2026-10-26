// Bewerbungs-Statistik als Discord-Embed.
const { embed } = require('../util');
const store = require('./store');

const DAY = 86_400_000;
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const SPARK = '▁▂▃▄▅▆▇█';
const HEAT = ' ░▒▓█';

const berlin = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
const WEEKDAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

function metrics(records) {
  const decided = records.filter((r) => r.decidedAt && r.status !== 'WITHDRAWN');
  const accepted = records.filter((r) => r.status === 'ACCEPTED').length;
  const rejected = records.filter((r) => r.status === 'REJECTED').length;
  const durations = decided.map((r) => r.decidedAt - r.createdAt);
  return {
    count: records.length,
    accepted,
    rejected,
    open: records.filter((r) => store.isOpenStatus(r.status)).length,
    withdrawn: records.filter((r) => r.status === 'WITHDRAWN').length,
    acceptRate: accepted + rejected ? accepted / (accepted + rejected) : null,
    completion: records.length ? (records.length - records.filter((r) => store.isOpenStatus(r.status)).length) / records.length : null,
    avgMs: durations.length ? durations.reduce((s, d) => s + d, 0) / durations.length : null,
  };
}

const percent = (v) => (v === null ? '—' : `${Math.round(v * 100)} %`);
function hours(ms) {
  if (ms === null) return '—';
  const h = ms / 3_600_000;
  return h < 48 ? `${h.toFixed(1).replace('.', ',')} Std.` : `${(h / 24).toFixed(1).replace('.', ',')} Tage`;
}
function delta(now, before, format = (v) => v, invert = false) {
  if (now === null || before === null || before === undefined) return '';
  const diff = now - before;
  if (Math.abs(diff) < 1e-9) return ' (±0)';
  const better = invert ? diff < 0 : diff > 0;
  return ` (${diff > 0 ? '+' : '−'}${format(Math.abs(diff))} ${better ? '📈' : '📉'})`;
}

function sparkline(values) {
  const max = Math.max(...values, 1);
  return values.map((v) => SPARK[Math.min(SPARK.length - 1, Math.round((v / max) * (SPARK.length - 1)))]).join('');
}

// Tageswerte in höchstens 30 Spalten zusammenfassen.
function bucketize(values, columns = 30) {
  if (values.length <= columns) return values;
  const size = Math.ceil(values.length / columns);
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size).reduce((s, v) => s + v, 0));
  return out;
}

function buildStats(guildId, days, { typeId, status, reviewerId } = {}) {
  const now = Date.now();
  const all = Object.values(store.recordsOf(guildId)).filter(
    (r) => (!typeId || r.type === typeId) && (!status || (status === 'OPEN' ? store.isOpenStatus(r.status) : r.status === status)) && (!reviewerId || r.decidedBy === reviewerId),
  );
  const current = all.filter((r) => r.createdAt >= now - days * DAY);
  const previous = all.filter((r) => r.createdAt >= now - 2 * days * DAY && r.createdAt < now - days * DAY);
  const m = metrics(current);
  const p = metrics(previous);

  const scope = [typeId && store.typeById(typeId)?.name, status && store.STATUS[status], reviewerId && `Prüfer <@${reviewerId}>`].filter(Boolean).join(' · ');
  const result = embed()
    .setTitle(`📊 Bewerbungen – letzte ${days} Tage`)
    .setDescription(`${scope ? `${scope}\n` : ''}Vergleich mit den ${days} Tagen davor.`)
    .addFields(
      { name: 'Bewerbungen', value: `**${m.count}**${delta(m.count, p.count)}`, inline: true },
      { name: 'Annahmequote', value: `**${percent(m.acceptRate)}**${delta(m.acceptRate, p.acceptRate, percent)}`, inline: true },
      { name: '⌀ Bearbeitungszeit', value: `**${hours(m.avgMs)}**${delta(m.avgMs, p.avgMs, hours, true)}`, inline: true },
      { name: 'Offen', value: `**${m.open}**`, inline: true },
      { name: 'Abschlussquote', value: `**${percent(m.completion)}**${delta(m.completion, p.completion, percent)}`, inline: true },
      { name: 'Aufteilung', value: `✅ ${m.accepted} · ⏳ ${m.open} · ❌ ${m.rejected} · ↩️ ${m.withdrawn}`, inline: true },
    );

  if (!current.length) return result;

  // Verlauf je Tag mit 7-Tage-Schnitt
  const perDay = Array.from({ length: days }, (_, i) => {
    const start = now - (days - i) * DAY;
    return current.filter((r) => r.createdAt >= start && r.createdAt < start + DAY).length;
  });
  const rolling = perDay.map((_, i) => {
    const window = perDay.slice(Math.max(0, i - 6), i + 1);
    return window.reduce((s, v) => s + v, 0) / window.length;
  });
  result.addFields({
    name: 'Verlauf',
    value: `\`${sparkline(bucketize(perDay))}\` je Tag\n\`${sparkline(bucketize(rolling))}\` 7-Tage-Schnitt (zuletzt ${rolling.at(-1).toFixed(1).replace('.', ',')}/Tag)`,
  });

  if (!typeId) {
    const perType = store
      .types()
      .map((t) => {
        const own = metrics(current.filter((r) => r.type === t.id));
        return own.count ? `${t.emoji} **${t.name}**: ${own.count} · ✅ ${own.accepted} · ❌ ${own.rejected} · ⏳ ${own.open}` : null;
      })
      .filter(Boolean);
    if (perType.length) result.addFields({ name: 'Je Bewerbungsart', value: perType.join('\n') });
  }

  const reviewers = {};
  for (const r of current) if (r.decidedBy && r.status !== 'WITHDRAWN') reviewers[r.decidedBy] = (reviewers[r.decidedBy] ?? 0) + 1;
  const top = Object.entries(reviewers)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);
  if (top.length) result.addFields({ name: 'Top-Prüfer', value: top.map(([id, n], i) => `${i + 1}. <@${id}> – ${n}`).join('\n') });

  // Heatmap Wochentag × Stunde (Berliner Zeit), je Zeichen eine Stunde
  const grid = WEEKDAYS.map(() => Array(24).fill(0));
  for (const r of current) {
    const parts = Object.fromEntries(berlin.formatToParts(new Date(r.createdAt)).map((x) => [x.type, x.value]));
    grid[WEEKDAY_INDEX[parts.weekday]][Number(parts.hour)]++;
  }
  const max = Math.max(...grid.flat(), 1);
  const rows = grid.map((row, i) => `${WEEKDAYS[i]} ${row.map((v) => HEAT[v ? Math.max(1, Math.round((v / max) * (HEAT.length - 1))) : 0]).join('')}`);
  result.addFields({ name: 'Eingänge nach Wochentag × Stunde', value: `\`\`\`\n   0     6     12    18   \n${rows.join('\n')}\n\`\`\`` });
  return result;
}

module.exports = { buildStats };
