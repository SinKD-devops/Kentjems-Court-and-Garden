import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Rules for creating a booking request.
 *
 * These run against `request_booking` with a real authenticated identity —
 * `set local role` plus JWT claims, so `auth.uid()` resolves exactly as it
 * does for a signed-in customer. Testing the function through a plain
 * superuser connection would skip the authorisation paths entirely, which is
 * where the interesting failures live.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const TEST_PHONE = "+639998887771";
const OTHER_PHONE = "+639998887772";

let db: Client;
let userId: string;
let otherId: string;

async function makeUser(phone: string): Promise<string> {
  const { rows } = await db.query(
    `insert into auth.users
       (instance_id, id, aud, role, phone, phone_confirmed_at, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
             'authenticated', 'authenticated', $1, now(), now(), now())
     returning id`,
    [phone],
  );
  return rows[0].id;
}

/** Run a statement as a signed-in customer. */
async function asUser<T>(id: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: id, role: "authenticated" }),
    ]);
    const { rows } = await db.query(sql, params);
    await db.query("commit");
    return rows as T[];
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

/** A Manila wall-clock hour on a day N days from today. */
function slotIn(days: number, hour: number): string {
  const manilaToday = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const [y, m, d] = manilaToday.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1, d + days, 12));
  return `${target.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:00:00+08`;
}

async function cleanBookings() {
  await db.query("delete from bookings where user_id in ($1, $2)", [userId, otherId]);
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  await db.query("delete from auth.users where phone in ($1, $2)", [TEST_PHONE, OTHER_PHONE]);
  userId = await makeUser(TEST_PHONE);
  otherId = await makeUser(OTHER_PHONE);
});

afterAll(async () => {
  if (!DATABASE_URL) return;
  await cleanBookings();
  await db.query("delete from auth.users where phone in ($1, $2)", [TEST_PHONE, OTHER_PHONE]);
  await db.end();
});

beforeEach(async () => {
  if (!DATABASE_URL) return;
  await cleanBookings();
  await db.query("update profiles set accepted_terms_at = null where id = $1", [userId]);
});

describe.skipIf(!DATABASE_URL)("request_booking", () => {
  it("creates a profile automatically for a new account", async () => {
    const { rows } = await db.query("select phone from profiles where id = $1", [userId]);
    expect(rows[0].phone).toBe(TEST_PHONE);
  });

  it("refuses until the terms are accepted", async () => {
    await expect(
      asUser(userId, "select request_booking('court', $1::timestamptz, false)", [slotIn(1, 19)]),
    ).rejects.toThrow(/accept the booking terms/i);
  });

  it("prices an evening slot at PHP 100 and sets a 30-minute expiry", async () => {
    const rows = await asUser<{ request_booking: string }>(
      userId,
      "select request_booking('court', $1::timestamptz, true)",
      [slotIn(1, 19)],
    );

    const { rows: booking } = await db.query(
      `select price_centavos, status,
              extract(epoch from (expires_at - now())) / 60 as minutes_left
       from bookings where id = $1`,
      [rows[0].request_booking],
    );

    expect(booking[0].price_centavos).toBe(10000);
    expect(booking[0].status).toBe("requested");
    expect(Number(booking[0].minutes_left)).toBeGreaterThan(28);
    expect(Number(booking[0].minutes_left)).toBeLessThanOrEqual(30);
  });

  it("prices a daytime slot at PHP 60", async () => {
    const rows = await asUser<{ request_booking: string }>(
      userId,
      "select request_booking('court', $1::timestamptz, true)",
      [slotIn(1, 9)],
    );
    const { rows: booking } = await db.query(
      "select price_centavos from bookings where id = $1",
      [rows[0].request_booking],
    );
    expect(booking[0].price_centavos).toBe(6000);
  });

  it("allows only one open request per space", async () => {
    await asUser(userId, "select request_booking('court', $1::timestamptz, true)", [
      slotIn(1, 9),
    ]);
    await expect(
      asUser(userId, "select request_booking('court', $1::timestamptz, true)", [slotIn(1, 10)]),
    ).rejects.toThrow(/already have an open request/i);
  });

  it("lets a second person request the same slot — the race is the design", async () => {
    const slot = slotIn(1, 15);
    await asUser(userId, "select request_booking('court', $1::timestamptz, true)", [slot]);
    await expect(
      asUser(otherId, "select request_booking('court', $1::timestamptz, true)", [slot]),
    ).resolves.toBeTruthy();
  });

  it("refuses a slot in the past", async () => {
    await expect(
      asUser(userId, "select request_booking('court', $1::timestamptz, true)", [slotIn(-1, 19)]),
    ).rejects.toThrow(/already passed/i);
  });

  it("refuses a slot beyond the 7-day window", async () => {
    await expect(
      asUser(userId, "select request_booking('court', $1::timestamptz, true)", [slotIn(30, 19)]),
    ).rejects.toThrow(/only 7 days ahead/i);
  });

  it("refuses an hour outside opening hours", async () => {
    await expect(
      asUser(userId, "select request_booking('court', $1::timestamptz, true)", [slotIn(1, 3)]),
    ).rejects.toThrow(/closed at that time/i);
  });

  it("refuses hourly requests against the garden", async () => {
    await expect(
      asUser(userId, "select request_booking('garden', $1::timestamptz, true)", [slotIn(1, 19)]),
    ).rejects.toThrow(/packages, not hourly/i);
  });

  it("refuses anonymous callers", async () => {
    await db.query("begin");
    await db.query("set local role anon");
    await expect(
      db.query("select request_booking('court', $1::timestamptz, true)", [slotIn(1, 19)]),
    ).rejects.toThrow();
    await db.query("rollback");
  });
});

describe.skipIf(!DATABASE_URL)("withdrawing and expiry", () => {
  it("frees the allowance when a request is withdrawn", async () => {
    const rows = await asUser<{ request_booking: string }>(
      userId,
      "select request_booking('court', $1::timestamptz, true)",
      [slotIn(1, 9)],
    );
    await asUser(userId, "select withdraw_booking($1)", [rows[0].request_booking]);

    await expect(
      asUser(userId, "select request_booking('court', $1::timestamptz, true)", [slotIn(1, 10)]),
    ).resolves.toBeTruthy();
  });

  it("stops blocking the moment it expires, without waiting for the sweep", async () => {
    const rows = await asUser<{ request_booking: string }>(
      userId,
      "select request_booking('court', $1::timestamptz, true)",
      [slotIn(1, 9)],
    );
    await db.query("update bookings set expires_at = now() - interval '1 minute' where id = $1", [
      rows[0].request_booking,
    ]);

    // The cron sweep is housekeeping, not correctness. If it is late or has
    // failed outright, a customer whose request expired must still be able
    // to make a new one — the unique index counts stale rows, so
    // request_booking retires the caller's own before inserting.
    await expect(
      asUser(userId, "select request_booking('court', $1::timestamptz, true)", [slotIn(1, 10)]),
    ).resolves.toBeTruthy();

    const { rows: after } = await db.query("select status from bookings where id = $1", [
      rows[0].request_booking,
    ]);
    expect(after[0].status).toBe("expired");
  });

  it("sweeps stale requests left behind by someone who never came back", async () => {
    const rows = await asUser<{ request_booking: string }>(
      otherId,
      "select request_booking('court', $1::timestamptz, true)",
      [slotIn(2, 9)],
    );
    await db.query("update bookings set expires_at = now() - interval '1 minute' where id = $1", [
      rows[0].request_booking,
    ]);

    const { rows: swept } = await db.query("select expire_stale_requests() as n");
    expect(Number(swept[0].n)).toBeGreaterThanOrEqual(1);

    const { rows: after } = await db.query("select status from bookings where id = $1", [
      rows[0].request_booking,
    ]);
    expect(after[0].status).toBe("expired");
  });
});

describe.skipIf(!DATABASE_URL)("availability pulse", () => {
  it("bumps the space revision whenever a booking changes", async () => {
    const { rows: space } = await db.query("select id from spaces where slug = 'court'");
    const before = await db.query(
      "select revision from availability_pulse where space_id = $1",
      [space[0].id],
    );

    await asUser(userId, "select request_booking('court', $1::timestamptz, true)", [
      slotIn(1, 11),
    ]);

    const after = await db.query(
      "select revision from availability_pulse where space_id = $1",
      [space[0].id],
    );
    expect(Number(after.rows[0].revision)).toBeGreaterThan(Number(before.rows[0].revision));
  });
});

describe.skipIf(!DATABASE_URL)("row level security", () => {
  it("hides one customer's bookings from another", async () => {
    await asUser(userId, "select request_booking('court', $1::timestamptz, true)", [
      slotIn(1, 12),
    ]);

    const mine = await asUser<{ n: string }>(userId, "select count(*)::int as n from bookings");
    const theirs = await asUser<{ n: string }>(otherId, "select count(*)::int as n from bookings");

    expect(Number(mine[0].n)).toBe(1);
    expect(Number(theirs[0].n)).toBe(0);
  });

  it("still shows the slot as taken through the public view", async () => {
    const slot = slotIn(1, 13);
    const rows = await asUser<{ request_booking: string }>(
      userId,
      "select request_booking('court', $1::timestamptz, true)",
      [slot],
    );
    await db.query("update bookings set status = 'confirmed' where id = $1", [
      rows[0].request_booking,
    ]);

    const seen = await asUser<{ n: string }>(
      otherId,
      "select count(*)::int as n from public_availability where starts_at = $1::timestamptz",
      [slot],
    );
    expect(Number(seen[0].n)).toBe(1);
  });
});
