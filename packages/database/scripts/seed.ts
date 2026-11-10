import { createDatabase } from '../src/client';
import { seedDatabase } from '../src/seed';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL fehlt.');
  process.exit(1);
}
const handle = createDatabase(url, { max: 1, applicationName: 'enrp-seed' });
try {
  const result = await seedDatabase(handle.db);
  console.log(
    `Seed abgeschlossen: ${result.roles} Rollen, ${result.factions} Fraktionen, ${result.flags} Feature-Flags neu angelegt.`,
  );
} finally {
  await handle.close();
}
