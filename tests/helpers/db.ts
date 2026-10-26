import { createPool, type Pool } from '@emden-network/database';

export function testPool(): Pool {
  return createPool({ connectionString: process.env.TEST_DATABASE_URL!, max: 10 });
}

/** Leert alle fachlichen Tabellen, Stammdaten (Fraktionen/Ränge) bleiben erhalten. */
export async function resetDb(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE
    command_job_results, command_jobs, game_events, game_server_players, game_servers,
    moderation_cases, ticket_messages, tickets, application_answers, applications,
    training_attendance, trainings, duty_sessions, faction_members,
    discord_links, oauth_verification_sessions, outbox_events, audit_logs, guild_config, users
    RESTART IDENTITY CASCADE`);
}

let counter = 100000000000000000n;
/** Eindeutige, syntaktisch gültige Discord-Snowflake für Tests. */
export function snowflake(): string {
  counter += 1n;
  return counter.toString();
}
