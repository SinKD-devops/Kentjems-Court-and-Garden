#!/usr/bin/env node
/**
 * Pushes every environment variable from .env.local to Vercel.
 *
 *   npm run vercel:env              # production
 *   npm run vercel:env -- preview   # preview deployments too
 *
 * Requires the Vercel CLI, signed in and linked to the project:
 *
 *   npm i -g vercel && vercel login && vercel link
 *
 * DATABASE_URL is deliberately never sent. It is a superuser connection used
 * only for migrations and tests, and a web app's runtime has no business
 * holding it — if the app is ever compromised, that is the difference between
 * losing what RLS allows and losing everything.
 *
 * Values are never printed. Names and outcomes only.
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const TARGET = process.argv[2] ?? "production";
/**
 * DATABASE_URL is a superuser connection for migrations and tests; the web
 * app runtime has no business holding it.
 *
 * The rest are reserved by Vercel or Node and are rejected on sight. TZ in
 * particular is dead config here anyway — every timezone in this app is an
 * explicit Asia/Manila or a fixed +08:00 offset, because relying on a process
 * timezone is how slots end up on the wrong date when a server moves region.
 */
const NEVER_SEND = new Set([
  "DATABASE_URL",
  "TZ",
  "PATH",
  "NODE_ENV",
  "PORT",
  "HOME",
]);

function run(args, input) {
  return new Promise((resolve) => {
    const child = spawn("npx", ["--yes", "vercel", ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));

    if (input !== undefined) {
      child.stdin.write(input);
    }
    child.stdin.end();

    child.on("close", (code) => resolve({ code, out }));
  });
}

const raw = await readFile(".env.local", "utf8").catch(() => null);
if (raw === null) {
  console.error("No .env.local found. Copy .env.example and fill it in first.");
  process.exit(1);
}

const vars = [];
const skipped = [];
const invalid = [];

for (const line of raw.split(/\r?\n/)) {
  // A byte order mark ends up glued to the first name when a file is written
  // by a Windows tool, producing a variable Next never sees — silently, since
  // a missing variable looks exactly like an unset one.
  const trimmed = line.replace(/﻿/g, "").trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq < 1) continue;

  const name = trimmed.slice(0, eq).trim();

  // Anything that is not a plain env name would be accepted by Vercel and
  // then never match what the code looks up.
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(name)) {
    invalid.push(name);
    continue;
  }
  const value = trimmed.slice(eq + 1).trim();
  if (!value) continue;

  // Vercel rejects reserved names outright, which stops the whole push. Skip
  // them here so one leftover line cannot fail the deploy.
  if (NEVER_SEND.has(name) || name.startsWith("VERCEL_") || name.startsWith("AWS_")) {
    skipped.push(name);
    continue;
  }

  vars.push([name, value]);
}

if (invalid.length > 0) {
  console.error(
    `\nNot valid environment variable names: ${invalid.join(", ")}\n` +
      "Usually an invisible character at the start of the line — a byte order\n" +
      "mark, typically. Fix .env.local and run again.\n",
  );
  process.exit(1);
}

if (vars.length === 0) {
  console.error("Nothing to send — .env.local has no filled-in values.");
  process.exit(1);
}

// A site URL pointing at localhost is the mistake that silently breaks the
// scheduled jobs, so it is worth stopping for rather than warning about.
const siteUrl = vars.find(([n]) => n === "NEXT_PUBLIC_SITE_URL")?.[1] ?? "";
if (siteUrl.includes("localhost")) {
  console.error(
    `\nNEXT_PUBLIC_SITE_URL is "${siteUrl}".\n` +
      "Set it to your real Vercel URL in .env.local first — the reminder and\n" +
      "purge jobs call it, and localhost is unreachable from Supabase.\n",
  );
  process.exit(1);
}

console.log(`\nSending ${vars.length} variables to Vercel (${TARGET}).`);
if (skipped.length > 0) {
  console.log(`Skipped on purpose: ${skipped.join(", ")}\n`);
}

let failures = 0;

for (const [name, value] of vars) {
  // Remove first: `vercel env add` refuses to overwrite an existing variable.
  await run(["env", "rm", name, TARGET, "--yes"]);
  const { code, out } = await run(["env", "add", name, TARGET], value);

  if (code === 0) {
    console.log(`  ok      ${name}`);
  } else {
    failures += 1;
    const reason = out.split("\n").find((l) => /error/i.test(l)) ?? `exit ${code}`;
    console.log(`  FAILED  ${name} — ${reason.trim()}`);
  }
}

console.log(
  failures === 0
    ? "\nDone. Redeploy for them to take effect — env changes do not apply to existing builds."
    : `\n${failures} variable(s) failed. Check that "vercel link" points at the right project.`,
);

process.exitCode = failures === 0 ? 0 : 1;
