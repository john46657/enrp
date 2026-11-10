// KI-Checker: lokale Heuristik ohne externen Dienst. Nur ein Hinweis, kein Beweis.
const PHRASES = [
  /\bals (eine )?(ki|künstliche intelligenz|sprachmodell)\b/i,
  /\bas an ai\b/i,
  /\bich hoffe,? (das|dies) hilft\b/i,
  /\bi hope this helps\b/i,
  /\bzusammenfassend (lässt sich|kann man) sagen\b/i,
  /\binsgesamt lässt sich (sagen|festhalten)\b/i,
  /\bes ist (wichtig|entscheidend|essenziell) zu (beachten|betonen|erwähnen)\b/i,
  /\bdarüber hinaus\b/i,
  /\bnicht zuletzt\b/i,
  /\bin der heutigen (zeit|welt|gesellschaft)\b/i,
  /\bich bin (fest )?davon überzeugt\b/i,
  /\b(fundierte|umfassende) (kenntnisse|erfahrung)\b/i,
  /\bein(e)? (tiefes|ausgeprägtes) verständnis\b/i,
  /\bmit (großer )?leidenschaft und (engagement|hingabe)\b/i,
  /\bwertvolle(n)? (bereicherung|beitrag)\b/i,
];
const CHAT_TRACES = [/^\s*(gerne|natürlich|selbstverständlich|sure|certainly)[!,.]/i, /\bhier (ist|sind) (eine?|meine|deine|die)\b[^.]*:/i];
const PLACEHOLDER = /\[(dein|deine|ihr|ihre|your|name|datum|ort|alter)[^\]]*\]/i;
const MARKDOWN = /\*\*[^*\n]+\*\*|^#{1,3} \S|^\s*(?:[-*]|\d+\.) .+\n\s*(?:[-*]|\d+\.) /m;

// answers: [{ question, answer, type, cpm? }] (cpm = Zeichen pro Minute beim Tippen, falls bekannt)
function aiCheck(answers) {
  const texts = answers.filter((a) => a.type === 'TEXT' && a.answer);
  const reasons = [];
  const flagged = new Set();
  let score = 0;

  const hits = (patterns, label, points, max) => {
    let found = 0;
    for (const a of texts) {
      if (patterns.some((p) => p.test(a.answer))) {
        found++;
        flagged.add(a.question);
      }
    }
    if (found) {
      score += Math.min(found * points, max);
      reasons.push(`${label} (${found}×)`);
    }
  };

  hits(PHRASES, 'typische KI-Formulierungen', 2, 6);
  hits(CHAT_TRACES, 'Chat-Spuren wie „Gerne! Hier ist …“', 3, 6);
  hits([PLACEHOLDER], 'Platzhalter wie „[Dein Name]“', 4, 8);
  hits([/—/], 'Geviertstrich (—)', 1, 3);
  hits([MARKDOWN], 'Markdown-Formatierung', 2, 4);

  const pasted = texts.filter((a) => a.cpm && a.answer.length >= 150 && a.cpm > 350);
  if (pasted.length) {
    pasted.forEach((a) => flagged.add(a.question));
    score += Math.min(pasted.length * 2, 6);
    reasons.push(`sehr schnelle Eingabe, vermutlich hineinkopiert (${pasted.length}×, bis ${Math.max(...pasted.map((a) => Math.round(a.cpm)))} Zeichen/Min.)`);
  }

  const long = texts.filter((a) => a.answer.length >= 80);
  if (long.length >= 4) {
    const lengths = long.map((a) => a.answer.length);
    const mean = lengths.reduce((s, l) => s + l, 0) / lengths.length;
    const deviation = Math.sqrt(lengths.reduce((s, l) => s + (l - mean) ** 2, 0) / lengths.length) / mean;
    if (deviation < 0.15 && long.every((a) => /[.!]$/.test(a.answer.trim()))) {
      score += 1;
      reasons.push('auffällig gleichförmiger Aufbau der Antworten');
    }
  }

  const level = score >= 6 ? 'hoch' : score >= 3 ? 'mittel' : 'gering';
  return { level, score, reasons, flagged: [...flagged] };
}

const AI_ICONS = { gering: '🟢', mittel: '🟡', hoch: '🔴' };

module.exports = { aiCheck, AI_ICONS };
