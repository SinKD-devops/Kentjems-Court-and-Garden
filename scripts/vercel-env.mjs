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
const NEVER_SEND = new Set(["DATABASE_URL"]);

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
for (const line of raw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq < 1) continue;

  const name = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim();
  if (!value || NEVER_SEND.has(name)) continue;
  vars.push([name, value]);
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
console.log("DATABASE_URL is skipped on purpose.\n");

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
