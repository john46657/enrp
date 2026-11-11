// HTML-Bausteine für Web-Formular und Dashboard (ohne Abhängigkeiten, ohne JavaScript im Browser).
const { base } = require('../lib/settings');

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const formatDate = (ms) =>
  new Date(ms).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Discord-Text (fett, kursiv, Zeitstempel, Erwähnungen) als sicheres HTML. names: (art, id) → Anzeigename.
function discordText(text, names = () => null) {
  return escapeHtml(text)
    .replace(/&lt;t:(\d+)(?::[a-zA-Z])?&gt;/g, (_, unix) => formatDate(Number(unix) * 1000))
    .replace(/&lt;@&amp;(\d+)&gt;/g, (_, id) => `@${escapeHtml(names('role', id) ?? 'Rolle')}`)
    .replace(/&lt;@!?(\d+)&gt;/g, (_, id) => `@${escapeHtml(names('user', id) ?? id)}`)
    .replace(/&lt;#(\d+)&gt;/g, (_, id) => `#${escapeHtml(names('channel', id) ?? id)}`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

const CSS = `
:root{--bg:#f4f5f8;--card:#fff;--text:#1c1e26;--muted:#5f6475;--line:#dcdfe8;--accent:${base.colors.primary};--ok:#1f8b4c;--bad:#c93b3e;--warn:#9a6b00;--field:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#14161c;--card:#1e2129;--text:#e7e9f0;--muted:#9aa0b4;--line:#323744;--ok:#57f287;--bad:#ff6b6e;--warn:#fee75c;--field:#14161c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:980px;margin:0 auto;padding:16px}
main.narrow{max-width:720px}
header.top{display:flex;flex-wrap:wrap;gap:8px 20px;align-items:center;padding:12px 16px;background:var(--card);border-bottom:1px solid var(--line)}
header.top strong{font-size:1.1rem}
nav{display:flex;flex-wrap:wrap;gap:4px}
nav a{padding:6px 12px;border-radius:8px;color:var(--text);text-decoration:none}
nav a.active,nav a:hover{background:var(--accent);color:#fff}
h1{font-size:1.5rem;margin:8px 0 12px}h2{font-size:1.15rem;margin:20px 0 8px}
a{color:var(--accent)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0}
.muted{color:var(--muted)}.small{font-size:.875rem}
.notice{padding:12px 16px;border-radius:10px;border:1px solid var(--line);background:var(--card);margin:12px 0}
.notice.error{border-color:var(--bad);color:var(--bad)}.notice.ok{border-color:var(--ok)}
label.q{display:block;font-weight:600;margin:0 0 4px}
.field{margin:0 0 20px}.field .hint{color:var(--muted);font-size:.875rem;margin:0 0 6px}
.field .err{color:var(--bad);font-size:.875rem;margin-top:4px}
textarea,input[type=text],input[type=number],select{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--field);color:var(--text);font:inherit}
textarea{min-height:120px;resize:vertical}
.option{display:flex;gap:8px;align-items:center;padding:6px 0}
button,.button{display:inline-block;padding:10px 18px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
button.ok{background:#1f8b4c}button.bad{background:#c93b3e}button.plain{background:transparent;color:var(--text);border:1px solid var(--line)}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:end}.row>*{flex:1 1 160px}.row>button{flex:0 0 auto}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-size:.8rem;text-transform:uppercase;letter-spacing:.04em}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.nowrap,td a strong{white-space:nowrap}
.tag{display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid var(--line);font-size:.8rem;white-space:nowrap}
.tag.ok{color:var(--ok);border-color:var(--ok)}.tag.bad{color:var(--bad);border-color:var(--bad)}.tag.warn{color:var(--warn);border-color:var(--warn)}
.answer{white-space:pre-wrap;overflow-wrap:anywhere}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.stats .card{margin:0}.stats b{display:block;font-size:1.6rem}
.bars{display:flex;align-items:flex-end;gap:2px;height:90px}
.bars span{flex:1;background:var(--accent);min-height:1px;border-radius:2px 2px 0 0}
`;

function page({ title, body, nav = '', narrow = false }) {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} – ${escapeHtml(base.serverName)}</title>
<style>${CSS}</style>
</head>
<body>
${nav}
<main${narrow ? ' class="narrow"' : ''}>
${body}
</main>
</body>
</html>`;
}

const notice = (text, kind = '') => `<div class="notice ${kind}">${text}</div>`;

module.exports = { escapeHtml, formatDate, discordText, page, notice };
