#!/usr/bin/env python3
"""Prüft SHA-256/HMAC aus roblox/ENRPBridge.server.lua gegen die Signatur des Bots (Node.js, src/lib/web/auth.js).

Aufruf (einmalig: pip install lupa):
    python3 scripts/test-lua-crypto.py

Der Crypto-Block des Spiel-Skripts läuft dabei in Lua 5.2 (gleiche bit32-Bibliothek wie Roblox/Luau).
"""
import json
import os
import random
import subprocess
import sys

try:
    from lupa import lua52
except ImportError:
    sys.exit("lupa fehlt: pip install lupa")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
source = open(os.path.join(ROOT, "roblox", "ENRPBridge.server.lua"), encoding="utf-8").read()
start = source.index("-- BEGIN CRYPTO")
end = source.index("-- END CRYPTO")
lua = lua52.LuaRuntime(encoding=None)
crypto = lua.execute((source[start:end] + "\nreturn Crypto").encode("utf-8"))

random.seed(42)
cases = []
for length in [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 5000]:
    cases.append(("k" * 43, "".join(random.choice("abcXYZ019 äöüß€\n{}\":,") for _ in range(length))))
cases.append(("x" * 100, "Schlüssel länger als 64 Bytes"))
cases.append(("kurz", ""))
cases.append(("A" * 64, "genau 64 Byte Schlüssel"))

# Erwartete Werte direkt aus der Bot-Implementierung (auth.sign) bzw. Node-crypto
node_script = """
const crypto = require('node:crypto');
const auth = require('./src/lib/web/auth');
const cases = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const out = cases.map(([key, msg]) => ({
  sha: crypto.createHash('sha256').update(msg, 'utf8').digest('hex'),
  hmac: crypto.createHmac('sha256', key).update(msg, 'utf8').digest('hex'),
}));
const parts = { timestamp: '1700000000', nonce: 'abcdefgh-1234-5678-9012-abcdefabcdef', method: 'POST', path: '/bridge/v1/events?x=1', body: '{"events":[{"n":"Jörg"}]}' };
out.push({ sign: auth.sign('k'.repeat(43), parts), canonical: auth.canonical(parts) });
process.stdout.write(JSON.stringify(out));
"""
# Eigene Wegwerf-Datenbank, damit der Test nie data/db.json anfasst
import tempfile
env = dict(os.environ, ENRP_DB_FILE=os.path.join(tempfile.gettempdir(), f"enrp-luatest-{os.getpid()}.json"))
result = subprocess.run(["node", "-e", node_script], cwd=ROOT, input=json.dumps(cases), capture_output=True, text=True, check=True, env=env)
expected = json.loads(result.stdout)
if os.path.exists(env["ENRP_DB_FILE"]):
    os.remove(env["ENRP_DB_FILE"])

failed = 0
for (key, msg), want in zip(cases, expected):
    got_sha = crypto.sha256Hex(msg.encode("utf-8")).decode()
    got_hmac = crypto.hmacSha256Hex(key.encode("utf-8"), msg.encode("utf-8")).decode()
    if got_sha != want["sha"] or got_hmac != want["hmac"]:
        failed += 1
        print(f"❌ Länge {len(msg.encode())}: sha {got_sha == want['sha']}, hmac {got_hmac == want['hmac']}")

sign = expected[-1]
lua_sign = crypto.hmacSha256Hex(("k" * 43).encode(), sign["canonical"].encode("utf-8")).decode()
if lua_sign != sign["sign"]:
    failed += 1
    print("❌ Signatur einer Bridge-Anfrage weicht ab")

if failed:
    sys.exit(f"❌ {failed} Abweichung(en)")
print(f"✅ Lua-SHA-256/HMAC stimmt mit dem Bot überein ({len(cases)} Fälle + Bridge-Signatur)")
