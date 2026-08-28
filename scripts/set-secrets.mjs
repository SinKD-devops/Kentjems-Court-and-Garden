#!/usr/bin/env node
/**
 * Loads PhilSMS credentials from .env.local into Supabase Vault.
 *
 * The SMS hook is a Postgres function, so it cannot read process.env — the
 * credentials have to live in the database. Vault encrypts them at rest and
 * keeps them out of migrations, out of git, and out of anything reachable
 * through the API.
 *
 *   npm run db:secrets
 *
 * Re-run this whenever a token is rotated.
 */

import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. See .env.example.");
  process.exit(1);
}

const secrets = [
  ["philsms_api_token", process.env.PHILSMS_API_TOKEN, "PhilSMS API token"],
  ["philsms_sender_id", process.env.PHILSMS_SENDER_ID, "PhilSMS sender ID"],
  ["philsms_api_url", process.env.PHILSMS_API_URL, "PhilSMS API base URL"],
  ["app_url", process.env.NEXT_PUBLIC_SITE_URL, "Public app URL for scheduled jobs"],
  ["cron_secret", process.env.CRON_SECRET, "Shared secret for cron endpoints"],
];

const client = new pg.Client({ connectionString: DATABASE_URL });

try {
  await client.connect();

  for (const [name, value, description] of secrets) {
    if (!value) {
      console.log(`  skipped ${name} (not set in .env.local)`);
      continue;
    }

    // create_secret rejects duplicate names, so replace rather than upsert.
    await client.query("delete from vault.secrets where name = $1", [name]);
    await client.query("select vault.create_secret($1, $2, $3)", [value, name, description]);
    console.log(`  stored  ${name}`);
  }

  const { rows } = await client.query(
    `select name, length(decrypted_secret) as len
     from vault.decrypted_secrets
     where name in ('philsms_api_token','philsms_sender_id','philsms_api_url','app_url','cron_secret')
     order by name`,
  );
  console.log("\nIn Vault:");
  for (const row of rows) console.log(`  ${row.name} (${row.len} chars)`);
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
