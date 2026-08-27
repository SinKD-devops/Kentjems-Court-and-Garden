#!/usr/bin/env node
/**
 * Minimal migration runner.
 *
 * Applies every file in supabase/migrations in filename order, once each,
 * tracked in a schema_migrations table. Each migration runs inside a
 * transaction, so a failure leaves nothing half-applied.
 *
 *   npm run db:push   apply pending migrations
 *   npm run db:seed   apply seed.sql (idempotent, safe to re-run)
 *
 * Reads DATABASE_URL from .env.local. Nothing here holds a credential.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });

const { DATABASE_URL } = process.env;
const command = process.argv[2] ?? "push";

if (!DATABASE_URL) {
  console.error(
    "\nDATABASE_URL is not set.\n\n" +
      "  1. Copy .env.example to .env.local\n" +
      "  2. Paste your connection string from\n" +
      "     Supabase → Project Settings → Database → Connection string → URI\n",
  );
  process.exit(1);
}

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const client = new pg.Client({ connectionString: DATABASE_URL });

async function push() {
  await client.query(`
    create table if not exists schema_migrations (
      version    text primary key,
      applied_at timestamptz not null default now()
    )`);

  // This table lives in the public schema, so PostgREST would otherwise
  // expose it. RLS on with no policies denies anon and authenticated
  // outright; the migration role bypasses RLS and is unaffected.
  await client.query("alter table schema_migrations enable row level security");

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const { rows } = await client.query("select version from schema_migrations");
  const applied = new Set(rows.map((r) => r.version));

  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) {
    console.log("Up to date — no pending migrations.");
    return;
  }

  for (const file of pending) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    process.stdout.write(`  applying ${file} ... `);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (version) values ($1)", [file]);
      await client.query("commit");
      console.log("ok");
    } catch (error) {
      await client.query("rollback");
      console.log("FAILED");
      throw error;
    }
  }
  console.log(`\nApplied ${pending.length} migration(s).`);
}

async function seed() {
  const sql = await readFile(join(process.cwd(), "supabase", "seed.sql"), "utf8");
  await client.query(sql);
  console.log("Seeded spaces, hours, pricing, packages, and settings.");
}

try {
  await client.connect();
  if (command === "push") await push();
  else if (command === "seed") await seed();
  else {
    console.error(`Unknown command "${command}". Use "push" or "seed".`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`\n${error.message}`);
  if (error.hint) console.error(`hint: ${error.hint}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
