// Vorlagen für neue Bewerbungsarten (/bewerbungsart erstellen vorlage:…).
// Eine Vorlage liefert Name, Emoji, Beschreibung, Nummern-Präfix, Prüfschritte und Fragen.
// Kanäle und Rollen kommen nie aus einer Vorlage – die stellt jeder Server selbst ein.

const text = (key, label, min = 20, max = 1000, extra = {}) => ({ key, type: 'TEXT', label, required: true, min, max, ...extra });
const choice = (key, label, options, extra = {}) => ({ key, type: 'CHOICE', label, required: true, multiple: false, options: options.map((o) => ({ label: o })), ...extra });

const ALTER = choice('alter', 'Wie alt bist du?', ['Unter 14', '14–15', '16–17', '18 oder älter']);
const AKTIVITAET = choice('aktivitaet', 'Wie aktiv kannst du sein?', ['Täglich', 'Mehrmals pro Woche', 'Am Wochenende', 'Unregelmäßig']);
const ZEITEN = choice('zeiten', 'Wann bist du meistens online?', ['Vormittags', 'Nachmittags', 'Abends', 'Nachts'], { multiple: true });
const MIKROFON = choice('mikrofon', 'Hast du ein funktionierendes Mikrofon?', ['Ja', 'Nein']);
const REGELN = choice('regeln', 'Hast du die Serverregeln gelesen und akzeptierst du sie?', ['Ja, gelesen und akzeptiert', 'Nein']);
const ROBLOX = { key: 'roblox', type: 'ROBLOX', label: 'Wie lautet dein Roblox-Benutzername?', required: true };

const PRUEFUNG = [
  { id: 'SCREENING', label: 'In Prüfung' },
  { id: 'INTERVIEW', label: 'Gespräch' },
  { id: 'PENDING_DECISION', label: 'Entscheidung ausstehend' },
];
const NUR_PRUEFUNG = [{ id: 'SCREENING', label: 'In Prüfung' }];

const TEMPLATES = {
  leer: {
    label: 'Leer (eigene Fragen)',
    type: {
      name: 'Neue Bewerbung',
      emoji: '📝',
      description: '',
      numberPrefix: '',
      stages: [],
      questions: [text('motivation', 'Warum möchtest du dich bewerben?', 30)],
    },
  },

  // ---------- Fraktionen ----------
  polizei: {
    label: 'Fraktion: Polizei',
    type: {
      name: 'Polizei-Bewerbung',
      emoji: '👮',
      description: 'Werde Polizeianwärter und starte deine Laufbahn bei uns.',
      numberPrefix: 'POL',
      stages: PRUEFUNG,
      questions: [
        ROBLOX,
        ALTER,
        text('erfahrung', 'Welche Erfahrung hast du im Polizei-RP?', 10),
        AKTIVITAET,
        text('motivation', 'Warum möchtest du zur Polizei?', 50),
        text('fall', 'Ein Verdächtiger flüchtet zu Fuß in ein Wohngebiet. Wie gehst du vor?', 50),
        text('konflikte', 'Wie gehst du mit Konflikten im Dienst um?', 30),
        REGELN,
      ],
    },
  },
  feuerwehr: {
    label: 'Fraktion: Feuerwehr',
    type: {
      name: 'Feuerwehr-Bewerbung',
      emoji: '🚒',
      description: 'Lösche Brände, rette Menschen und hilf bei technischen Einsätzen.',
      numberPrefix: 'FW',
      stages: PRUEFUNG,
      questions: [
        ROBLOX,
        ALTER,
        text('erfahrung', 'Welche Erfahrung hast du im Feuerwehr- oder Rettungs-RP?', 10),
        AKTIVITAET,
        text('motivation', 'Warum möchtest du zur Feuerwehr?', 50),
        text('fall', 'Bei einem Verkehrsunfall brennt ein Auto, eine Person ist eingeklemmt. Was tust du zuerst?', 50),
        REGELN,
      ],
    },
  },
  rettungsdienst: {
    label: 'Fraktion: Rettungsdienst',
    type: {
      name: 'Rettungsdienst-Bewerbung',
      emoji: '🚑',
      description: 'Versorge Verletzte und bringe sie sicher ins Krankenhaus.',
      numberPrefix: 'RD',
      stages: PRUEFUNG,
      questions: [
        ROBLOX,
        ALTER,
        text('erfahrung', 'Welche Erfahrung hast du im Rettungsdienst-RP?', 10),
        AKTIVITAET,
        text('motivation', 'Warum möchtest du zum Rettungsdienst?', 50),
        text('fall', 'Du kommst zu einer bewusstlosen Person. Wie läuft deine Erstversorgung im RP ab?', 50),
        REGELN,
      ],
    },
  },
  abschleppdienst: {
    label: 'Fraktion: Abschleppdienst / Pannenhilfe',
    type: {
      name: 'Abschleppdienst-Bewerbung',
      emoji: '🛻',
      description: 'Schleppe Fahrzeuge ab und hilf bei Pannen.',
      numberPrefix: 'ADS',
      stages: NUR_PRUEFUNG,
      questions: [
        ROBLOX,
        ALTER,
        text('erfahrung', 'Welche Erfahrung hast du als Abschlepper oder Mechaniker im RP?', 10),
        AKTIVITAET,
        text('motivation', 'Warum möchtest du zum Abschleppdienst?', 30),
        REGELN,
      ],
    },
  },
  justiz: {
    label: 'Fraktion: Justiz / Anwalt',
    type: {
      name: 'Justiz-Bewerbung',
      emoji: '⚖️',
      description: 'Richter, Staatsanwalt oder Anwalt – sorge für faire Verfahren.',
      numberPrefix: 'JUS',
      stages: PRUEFUNG,
      questions: [
        ROBLOX,
        ALTER,
        choice('rolle', 'Als was möchtest du arbeiten?', ['Richter', 'Staatsanwalt', 'Anwalt']),
        text('erfahrung', 'Welche Erfahrung hast du mit Gerichts-RP?', 10),
        text('motivation', 'Warum möchtest du zur Justiz?', 50),
        text('fall', 'Ein Angeklagter beleidigt im Gerichtssaal den Richter. Wie reagierst du in deiner Rolle?', 30),
        REGELN,
      ],
    },
  },
  zivil: {
    label: 'Fraktion: Firma / Zivil (z. B. Taxi, Händler)',
    type: {
      name: 'Firmen-Bewerbung',
      emoji: '🏢',
      description: 'Arbeite in einer Firma auf dem Server.',
      numberPrefix: 'FIR',
      stages: NUR_PRUEFUNG,
      questions: [
        ROBLOX,
        ALTER,
        text('motivation', 'Warum möchtest du in dieser Firma arbeiten?', 30),
        text('charakter', 'Erzähl kurz etwas über deinen RP-Charakter.', 30),
        AKTIVITAET,
        REGELN,
      ],
    },
  },
  einheit: {
    label: 'Einheit / Qualifikation (z. B. SEK, Ausbilder)',
    type: {
      name: 'Einheit',
      emoji: '🎖️',
      description: 'Bewirb dich für eine Spezialeinheit oder Qualifikation.',
      numberPrefix: 'Q',
      stages: [],
      questions: [
        text('erfahrung', 'Welche Erfahrung bringst du dafür mit?', 10),
        text('motivation', 'Warum möchtest du in diese Einheit?', 30),
        ZEITEN,
      ],
    },
  },

  // ---------- Server-Team ----------
  supporter: {
    label: 'Team: Supporter',
    type: {
      name: 'Supporter-Bewerbung',
      emoji: '🛟',
      description: 'Hilf Spielern bei Fragen und Problemen im Support.',
      numberPrefix: 'SUP',
      stages: PRUEFUNG,
      questions: [
        ALTER,
        text('erfahrung', 'Hast du schon Erfahrung im Support oder in einem Server-Team? Wo?', 10),
        ZEITEN,
        MIKROFON,
        text('motivation', 'Warum möchtest du Supporter werden?', 50),
        text('fall', 'Ein Spieler ist im Ticket sehr unfreundlich zu dir. Wie reagierst du?', 50),
        text('staerken', 'Was sind deine Stärken und Schwächen?', 30),
        REGELN,
      ],
    },
  },
  moderator: {
    label: 'Team: Moderator',
    type: {
      name: 'Moderator-Bewerbung',
      emoji: '🛡️',
      description: 'Sorge dafür, dass die Regeln eingehalten werden.',
      numberPrefix: 'MOD',
      stages: PRUEFUNG,
      questions: [
        ALTER,
        text('erfahrung', 'Welche Erfahrung hast du als Moderator?', 10),
        ZEITEN,
        MIKROFON,
        text('motivation', 'Warum möchtest du Moderator werden?', 50),
        text('fall', 'Zwei Spieler streiten sich im öffentlichen Chat und beleidigen sich. Was tust du?', 50),
        text('fall2', 'Ein Freund von dir bricht die Regeln. Wie gehst du damit um?', 30),
        REGELN,
      ],
    },
  },
  entwickler: {
    label: 'Team: Entwickler',
    type: {
      name: 'Entwickler-Bewerbung',
      emoji: '💻',
      description: 'Baue mit an Bots, Skripten und Systemen des Servers.',
      numberPrefix: 'DEV',
      stages: PRUEFUNG,
      questions: [
        ALTER,
        choice('bereich', 'In welchen Bereichen kennst du dich aus?', ['Discord-Bots', 'Lua / FiveM', 'Roblox / Luau', 'Web', 'Grafik / Design'], { multiple: true }),
        text('projekte', 'Welche Projekte hast du schon umgesetzt? (Links gern dazu)', 20),
        text('motivation', 'Warum möchtest du bei uns entwickeln?', 30),
        ZEITEN,
      ],
    },
  },
  eventteam: {
    label: 'Team: Event-Team',
    type: {
      name: 'Event-Team-Bewerbung',
      emoji: '🎉',
      description: 'Plane und leite Events für die Community.',
      numberPrefix: 'EVT',
      stages: NUR_PRUEFUNG,
      questions: [
        ALTER,
        text('idee', 'Beschreibe eine Event-Idee, die du gern umsetzen würdest.', 50),
        text('erfahrung', 'Hast du schon Events organisiert?', 10),
        ZEITEN,
        MIKROFON,
      ],
    },
  },

  // ---------- Sonstiges ----------
  creator: {
    label: 'Content Creator / Streamer',
    type: {
      name: 'Content-Creator-Bewerbung',
      emoji: '🎥',
      description: 'Streame oder mache Videos auf unserem Server.',
      numberPrefix: 'CC',
      stages: NUR_PRUEFUNG,
      questions: [
        choice('plattform', 'Auf welchen Plattformen bist du aktiv?', ['Twitch', 'YouTube', 'TikTok', 'Kick', 'Andere'], { multiple: true }),
        text('kanal', 'Link zu deinem Kanal', 5, 300),
        text('reichweite', 'Wie viele Follower/Abonnenten und Zuschauer hast du im Schnitt?', 2, 300),
        text('inhalt', 'Was für Inhalte möchtest du auf unserem Server machen?', 30),
      ],
    },
  },
  partnerschaft: {
    label: 'Partnerschaft',
    type: {
      name: 'Partnerschaftsanfrage',
      emoji: '🤝',
      description: 'Werde Partner unseres Servers.',
      numberPrefix: 'PAR',
      stages: [],
      questions: [
        text('server', 'Wie heißt euer Server und worum geht es?', 20),
        text('einladung', 'Dauerhafter Einladungslink', 5, 200),
        text('mitglieder', 'Wie viele Mitglieder habt ihr?', 1, 100),
        text('vorteil', 'Was bringt eine Partnerschaft beiden Seiten?', 30),
      ],
    },
  },
  entbannung: {
    label: 'Entbannungsantrag',
    type: {
      name: 'Entbannungsantrag',
      emoji: '🔓',
      description: 'Bitte um Aufhebung eines Banns im Spiel.',
      numberPrefix: 'EB',
      stages: NUR_PRUEFUNG,
      questions: [
        ROBLOX,
        text('wann', 'Wann und von wem wurdest du gebannt (falls bekannt)?', 5, 500),
        text('grund', 'Warum wurdest du gebannt?', 20),
        text('einsicht', 'Was hast du daraus gelernt und warum sollten wir dich entbannen?', 50),
      ],
    },
  },
};

// Neue, unabhängige Kopie einer Vorlage (oder null).
function build(id) {
  const template = TEMPLATES[id];
  return template ? structuredClone(template.type) : null;
}

const choices = () => Object.entries(TEMPLATES).map(([value, t]) => ({ name: t.label, value }));

module.exports = { TEMPLATES, build, choices };
