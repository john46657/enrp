import type { z } from 'zod';

export class EnvError extends Error {
  override name = 'EnvError';
}

/**
 * Prüft die Umgebungsvariablen gegen ein Zod-Schema und gibt sie typisiert zurück.
 * Fehlt etwas oder ist ungültig, wird eine Liste aller Probleme geworfen – ohne die Werte selbst,
 * damit keine Geheimnisse in Logs landen.
 */
export function loadEnv<T extends z.ZodType>(schema: T, source: NodeJS.ProcessEnv = process.env): z.infer<T> {
  // Leere Einträge wie „DISCORD_TOKEN=“ aus der .env-Vorlage zählen als nicht gesetzt.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== ''));
  const result = schema.safeParse(cleaned);
  if (result.success) return result.data;

  const lines = result.error.issues.map((issue) => `  - ${issue.path.join('.') || '(gesamt)'}: ${issue.message}`);
  throw new EnvError(
    `Ungültige oder fehlende Umgebungsvariablen:\n${lines.join('\n')}\nVergleiche deine .env mit der .env.example.`,
  );
}
