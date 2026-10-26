import { createPool } from './pool.js';
import { migrate, migrationStatus } from './migrate.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL fehlt.');
  process.exit(1);
}
const pool = createPool({ connectionString: url, applicationName: 'emden-network-migrate', statementTimeoutMs: 0 });
const cmd = process.argv[2] ?? 'up';
try {
  if (cmd === 'up') {
    const applied = await migrate(pool, { log: (m) => console.log(m) });
    console.log(applied.length ? `${applied.length} Migration(en) angewendet.` : 'Datenbank ist aktuell.');
  } else if (cmd === 'status') {
    for (const m of await migrationStatus(pool)) console.log(`${m.applied ? '✔' : '✘'} ${m.version}_${m.name}`);
  } else {
    console.error(`Unbekannter Befehl: ${cmd} (erlaubt: up, status)`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
