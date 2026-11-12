// Logik für check-domain.mjs (getrennt, damit sie mit einem Fake-fetch getestet werden kann).

async function probe(fetchImpl, url, init) {
  try {
    const res = await fetchImpl(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* kein JSON */
    }
    return { status: res.status, json, text };
  } catch (err) {
    return { status: 0, json: null, text: '', error: err.cause?.code ?? err.message };
  }
}

export async function checkDomain(base, fetchImpl) {
  const results = [];

  const health = await probe(fetchImpl, `${base}/healthz`);
  results.push({
    name: 'Dashboard (/healthz)',
    ok: health.status === 200 && health.json?.status === 'ok',
    detail:
      health.status === 200 && health.json?.status === 'ok'
        ? 'Next.js-Dashboard antwortet'
        : health.status === 200
          ? 'Antwort ist kein ENRP-Dashboard (vermutlich altes Express-Dashboard der Altmodule)'
          : `HTTP ${health.status || health.error}`,
  });

  const status = await probe(fetchImpl, `${base}/api/v1/status`);
  const statusOk = status.status === 200 && typeof status.json?.status === 'string';
  results.push({
    name: 'API (/api/v1/status)',
    ok: statusOk,
    detail: statusOk
      ? `Plattform-Status „${status.json.status}“, Roblox ${status.json.roblox?.connected ? 'verbunden' : 'nicht verbunden'}`
      : status.json?.error === 'Nicht angemeldet'
        ? 'Antwort kommt vom alten Express-Dashboard – die neue API ist nicht erreichbar'
        : `HTTP ${status.status || status.error}`,
  });

  // Ohne Schlüssel muss die Roblox-Schnittstelle mit dem einheitlichen API-Fehlerformat ablehnen.
  const game = await probe(fetchImpl, `${base}/api/v1/game/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const gameOk = (game.status === 401 || game.status === 403) && typeof game.json?.error?.code === 'string';
  results.push({
    name: 'Roblox-Schnittstelle (/api/v1/game/heartbeat)',
    ok: gameOk,
    detail: gameOk
      ? `lehnt Anfragen ohne Schlüssel korrekt ab (${game.json.error.code})`
      : `unerwartete Antwort (HTTP ${game.status || game.error})`,
  });
  return results;
}
