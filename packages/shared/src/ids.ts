import { z } from 'zod';

export const snowflake = z.string().regex(/^[0-9]{17,20}$/, 'Ungültige Discord-ID');
/** Roblox-User-IDs sind positive 64-Bit-Ganzzahlen; wir transportieren sie als Dezimalstring. */
export const robloxUserId = z
  .union([z.string(), z.number().int()])
  .transform((v) => String(v))
  .pipe(z.string().regex(/^[1-9][0-9]{0,18}$/, 'Ungültige Roblox-ID'));
