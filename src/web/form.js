// Browser-Formular für Bewerbungen (mode: "WEB"). Der Zugang ist ein signierter, persönlicher Link aus Discord.
const web = require('../lib/web');
const store = require('../lib/applications/store');
const { checkAnswer, optionValue, formatDuration } = require('../lib/applications/forms');
const { findRobloxUser } = require('../lib/applications/roblox');
const { submitApplication } = require('../lib/applications/flow');
const { escapeHtml, formatDate, discordText, page, notice } = require('./html');
const HttpError = require('./httpError');

const fieldName = (index) => `q_${index}`;

function renderField(q, index, values, error) {
  const name = fieldName(index);
  const given = values.getAll(name);
  const required = q.required !== false;
  let control;
  if (q.type === 'TEXT') {
    const max = Math.min(q.max ?? 5000, 5000);
    control = `<textarea id="${name}" name="${name}"${required ? ' required' : ''}${q.min ? ` minlength="${q.min}"` : ''} maxlength="${max}">${escapeHtml(given[0] ?? '')}</textarea>
      <div class="hint">${q.min ? `Mindestens ${q.min}, h` : 'H'}öchstens ${max} Zeichen</div>`;
  } else if (q.type === 'ROBLOX') {
    control = `<input type="text" id="${name}" name="${name}"${required ? ' required' : ''} minlength="3" maxlength="20" pattern="[A-Za-z0-9_]{3,20}" autocomplete="off" value="${escapeHtml(given[0] ?? '')}">
      <div class="hint">Dein Roblox-Benutzername (nicht der Anzeigename). Das Konto wird beim Absenden geprüft.</div>`;
  } else {
    const kind = q.multiple ? 'checkbox' : 'radio';
    control = q.options
      .map((option, i) => {
        const value = optionValue(option);
        const needs = required && !q.multiple ? ' required' : '';
        return `<label class="option"><input type="${kind}" name="${name}" value="${escapeHtml(value)}"${given.includes(value) ? ' checked' : ''}${needs}> <span>${escapeHtml(option.label)}${option.description ? ` <span class="muted small">– ${escapeHtml(option.description)}</span>` : ''}</span></label>`;
      })
      .join('\n');
    if (q.multiple) control += '<div class="hint">Mehrere Antworten möglich.</div>';
  }
  const labelFor = q.type === 'TEXT' || q.type === 'ROBLOX' ? ` for="${name}"` : '';
  return `<div class="field">
    <label class="q"${labelFor}>${index + 1}. ${escapeHtml(q.label)}${required ? '' : ' <span class="muted small">(optional)</span>'}</label>
    ${q.description ? `<div class="hint">${discordText(q.description)}</div>` : ''}
    ${control}
    ${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
  </div>`;
}

function renderForm({ type, guild, member, payload, values = new URLSearchParams(), errors = {}, topError = null }) {
  const body = `
    <h1>${escapeHtml(type.emoji)} ${escapeHtml(type.name)}</h1>
    <p class="muted">${escapeHtml(guild.name)} · angemeldet als <strong>${escapeHtml(member.user.tag)}</strong> · ${type.questions.length} Fragen · Link gültig bis ${formatDate(payload.exp)} (${formatDuration(type.timeLimitMinutes)})</p>
    ${topError ? notice(discordText(topError), 'error') : ''}
    <form method="post" class="card">
      ${type.questions.map((q, i) => renderField(q, i, values, errors[i])).join('\n')}
      <button type="submit">Bewerbung absenden</button>
    </form>`;
  return page({ title: type.name, narrow: true, body });
}

const message = (title, html, kind = '') => page({ title, narrow: true, body: `<h1>${escapeHtml(title)}</h1>${notice(html, kind)}` });

// Liest die Formularfelder in Antworten um; füllt errors je Frage.
async function collectAnswers(type, values, errors) {
  const answers = [];
  const roleSelections = [];
  let roblox = null;
  for (const [index, q] of type.questions.entries()) {
    const given = values.getAll(fieldName(index));
    const entry = { key: q.key, question: q.label, type: q.type, answer: '', raw: null, ms: 0 };
    if (q.type === 'CHOICE' || q.type === 'ROLE') {
      const error = checkAnswer(q, given);
      if (error) errors[index] = error;
      else if (given.length) {
        const chosen = q.options.filter((o) => given.includes(optionValue(o)));
        entry.raw = given;
        entry.answer = chosen.map((o) => o.label).join(', ');
        if (q.type === 'ROLE') roleSelections.push(...chosen.map((o) => o.roleId));
      }
    } else {
      const text = (given[0] ?? '').replace(/\r\n/g, '\n').trim();
      const error = checkAnswer(q, text);
      if (error) errors[index] = error;
      else if (text && q.type === 'ROBLOX') {
        try {
          const found = await findRobloxUser(text);
          if (!found) errors[index] = `Es gibt kein Roblox-Konto „${text}“. Prüfe die Schreibweise.`;
          else {
            roblox = { id: found.id, name: found.name };
            entry.raw = found.name;
            entry.answer = `${found.name} (ID ${found.id})`;
          }
        } catch {
          errors[index] = 'Roblox ist gerade nicht erreichbar. Bitte sende das Formular gleich noch einmal ab.';
        }
      } else if (text) {
        entry.raw = text;
        entry.answer = text;
      }
    }
    answers.push(entry);
  }
  return { answers, roleSelections, roblox };
}

async function handle(request, token) {
  const payload = web.verify(token, 'apply');
  if (!payload) return { status: 403, html: message('Link ungültig', 'Dieser Link ist ungültig oder abgelaufen. Starte die Bewerbung in Discord neu, um einen neuen Link zu bekommen.', 'error') };
  const guild = request.client.guilds.cache.get(payload.g);
  const type = guild && store.typeById(guild.id, payload.t);
  if (!type) throw new HttpError(404, 'Diese Bewerbung gibt es nicht mehr.');
  const member = await guild.members.fetch(payload.u).catch(() => null);
  if (!member) throw new HttpError(403, 'Du bist nicht mehr auf dem Discord-Server.');
  const names = (kind, id) => (kind === 'role' ? guild.roles.cache.get(id)?.name : null);
  const context = { type, guild, member, payload };

  if (request.method === 'GET') {
    const blocked = store.eligibility(member, type);
    if (blocked) return { status: 403, html: message(type.name, discordText(blocked, names), 'error') };
    return { html: renderForm(context) };
  }

  const errors = {};
  const { answers, roleSelections, roblox } = await collectAnswers(type, request.body, errors);
  if (Object.keys(errors).length) {
    return { status: 422, html: renderForm({ ...context, values: request.body, errors, topError: 'Bitte prüfe die markierten Antworten.' }) };
  }
  const { error, record } = await submitApplication(request.client, { guildId: guild.id, typeId: type.id, userId: member.id, answers, roleSelections, roblox, startedAt: payload.iat, via: 'WEB' });
  if (error) return { status: 422, html: renderForm({ ...context, values: request.body, topError: error }) };
  return {
    html: message(
      'Bewerbung eingereicht',
      `Deine <strong>${escapeHtml(type.name)}</strong> ist eingegangen. Deine Bewerbungsnummer: <strong>${escapeHtml(record.number)}</strong>.<br>Das Team meldet sich per Discord-Direktnachricht bei dir – lass deine DMs offen. Du kannst dieses Fenster schließen.`,
      'ok',
    ),
  };
}

module.exports = { handle, renderForm, collectAnswers };
