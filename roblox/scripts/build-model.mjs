// Baut Roblox-Modelldateien (.rbxmx) aus roblox/src, damit die Skripte in Studio per
// „Aus Datei einfügen“ eingefügt werden können, statt sie einzeln zu kopieren.
// Aufruf: node roblox/scripts/build-model.mjs [--url https://deine-adresse]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const urlArg = process.argv.indexOf('--url');
const apiUrl = urlArg > 0 ? process.argv[urlArg + 1]?.replace(/\/$/, '') : null;
if (urlArg > 0 && !/^https:\/\/[\w.-]+(:\d+)?$/.test(apiUrl ?? '')) {
  console.error('--url muss eine HTTPS-Adresse ohne Pfad sein, z. B. https://abc.trycloudflare.com');
  process.exit(1);
}

let ref = 0;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function item(className, name, source, children = '') {
  if (source?.includes(']]>')) throw new Error(`${name}: Quelltext enthält "]]>"`);
  const src = source === undefined ? '' : `<ProtectedString name="Source"><![CDATA[${source}]]></ProtectedString>`;
  return `<Item class="${className}" referent="RBX${ref++}"><Properties><string name="Name">${esc(name)}</string>${src}</Properties>${children}</Item>`;
}
const doc = (body) =>
  `<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">${body}</roblox>\n`;

function scriptFor(dir, file) {
  let source = readFileSync(join(dir, file), 'utf8');
  if (file === 'Config.lua' && apiUrl) {
    const replaced = source.replace(/ApiBaseUrl = "[^"]*"/, `ApiBaseUrl = "${apiUrl}"`);
    if (replaced === source) throw new Error('ApiBaseUrl in Config.lua nicht gefunden');
    source = replaced;
  }
  if (file.endsWith('.server.lua')) return item('Script', file.replace('.server.lua', ''), source);
  if (file.endsWith('.client.lua')) return item('LocalScript', file.replace('.client.lua', ''), source);
  return item('ModuleScript', file.replace('.lua', ''), source);
}

const serverDir = join(root, 'src/ServerScriptService/ENRP');
const server = readdirSync(serverDir).filter((f) => f.endsWith('.lua')).sort();
writeFileSync(join(root, 'ENRP-Server.rbxmx'), doc(item('Folder', 'ENRP', undefined, server.map((f) => scriptFor(serverDir, f)).join(''))));

const clientDir = join(root, 'src/StarterPlayer/StarterPlayerScripts');
const client = readdirSync(clientDir).filter((f) => f.endsWith('.lua'));
writeFileSync(join(root, 'ENRP-Client.rbxmx'), doc(client.map((f) => scriptFor(clientDir, f)).join('')));

console.log(`roblox/ENRP-Server.rbxmx (${server.length} Skripte) und roblox/ENRP-Client.rbxmx erstellt${apiUrl ? ` – ApiBaseUrl = ${apiUrl}` : ''}.`);
