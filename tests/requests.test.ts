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

describe.skipIf(!DATABASE_URL)("multi-hour bookings", () => {
  const book = (hours: number, startHour: number) =>
    asUser<{ request_booking: string }>(
      userId,
      "select request_booking('court', $1::timestamptz, true, $2)",
      [slotIn(1, startHour), hours],
    );

  const priceOf = async (id: string) => {
    const { rows } = await db.query(
      `select price_centavos, extract(epoch from (ends_at - starts_at)) / 3600 as hours
       from bookings where id = $1`,
      [id],
    );
    return { price: rows[0].price_centavos, hours: Number(rows[0].hours) };
  };

  it("charges three daytime hours at PHP 180", async () => {
    const rows = await book(3, 9);
    expect(await priceOf(rows[0].request_booking)).toEqual({ price: 18000, hours: 3 });
  });

  it("sums across the evening boundary rather than charging the start rate", async () => {
    // 5-8 PM is one daytime hour and two evening hours: 60 + 100 + 100.
    // Charging three hours at the 5 PM rate would sell the evening for 180.
    const rows = await book(3, 17);
    expect(await priceOf(rows[0].request_booking)).toEqual({ price: 26000, hours: 3 });
  });

  it("refuses a range that would run past midnight", async () => {
    // 11 PM plus two hours ends at 1 AM. The old check compared clock times,
    // where 01:00 is not later than 24:00, so this was accepted.
    await expect(book(2, 23)).rejects.toThrow(/closed at that time/i);
  });

  it("allows a range ending exactly at midnight", async () => {
    await expect(book(2, 22)).resolves.toBeTruthy();
  });

  it("refuses a range starting before opening", async () => {
    await expect(book(2, 5)).rejects.toThrow(/closed at that time/i);
  });

  it("rejects nonsense hour counts", async () => {
    await expect(book(0, 9)).rejects.toThrow(/between 1 and 12 hours/i);
    await expect(book(20, 9)).rejects.toThrow(/between 1 and 12 hours/i);
  });

  it("blocks every hour it covers", async () => {
    await book(3, 9);
    const { rows } = await db.query(
      `select count(*)::int as n from public_availability
       where starts_at < $2::timestamptz and ends_at > $1::timestamptz`,
      [slotIn(1, 10), slotIn(1, 11)],
    );
    // The middle hour of the block is covered even though nothing starts there.
    expect(rows[0].n).toBe(0); // still only 'requested', so not yet blocking

    await db.query("update bookings set status = 'confirmed' where user_id = $1", [userId]);
    const { rows: after } = await db.query(
      `select count(*)::int as n from public_availability
       where starts_at < $2::timestamptz and ends_at > $1::timestamptz`,
      [slotIn(1, 10), slotIn(1, 11)],
    );
    expect(after[0].n).toBe(1);
  });

  it("still counts as a single open request", async () => {
    await book(3, 9);
    await expect(book(1, 14)).rejects.toThrow(/already have an open request/i);
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

describe.skipIf(!DATABASE_URL)("superseding the losers", () => {
  /**
   * The people who lose a contested slot have to be told. Their request cost
   * them nothing, so without a message their only feedback is walking to the
   * store to pay for a court that is already gone.
   */
  async function raceAndConfirm(confirmFn: string) {
    const slot = slotIn(1, 16);

    const winner = await asUser<{ request_booking: string }>(
      userId,
      "select request_booking('court', $1::timestamptz, true, 1)",
      [slot],
    );
    await asUser(otherId, "select request_booking('court', $1::timestamptz, true, 1)", [slot]);

    await db.query("update profiles set role = 'operator' where id = $1", [userId]);
    if (confirmFn === "approve_payment") {
      await db.query(
        `insert into payments (booking_id, method, amount_centavos, reference_number, status)
         values ($1, 'gcash', 6000, $2, 'pending')`,
        [winner[0].request_booking, `ref-${Date.now()}`],
      );
      await db.query("update bookings set status = 'proof_submitted' where id = $1", [
        winner[0].request_booking,
      ]);
    }

    const result = await asUser<{ [k: string]: unknown }>(
      userId,
      `select ${confirmFn}($1) as r`,
      [winner[0].request_booking],
    );

    await db.query("update profiles set role = 'customer' where id = $1", [userId]);
    return result[0].r as { space: string; superseded: { phone: string }[] };
  }

  it("returns who lost the slot when a payment is approved", async () => {
    const result = await raceAndConfirm("approve_payment");
    expect(result.space).toBe("Court");
    expect(result.superseded).toHaveLength(1);
    expect(result.superseded[0].phone).toBe(OTHER_PHONE);
  });

  it("does the same when cash is taken at the counter", async () => {
    const result = await raceAndConfirm("confirm_cash_payment");
    expect(result.superseded).toHaveLength(1);
    expect(result.superseded[0].phone).toBe(OTHER_PHONE);
  });

  it("records the cash payment against the booking", async () => {
    await raceAndConfirm("confirm_cash_payment");
    const { rows } = await db.query(
      "select method, status from payments where method = 'cash' order by submitted_at desc limit 1",
    );
    expect(rows[0]).toMatchObject({ method: "cash", status: "approved" });
  });

  it("refuses to let a customer confirm their own payment", async () => {
    const rows = await asUser<{ request_booking: string }>(
      userId,
      "select request_booking('court', $1::timestamptz, true, 1)",
      [slotIn(1, 8)],
    );
    await expect(
      asUser(userId, "select confirm_cash_payment($1)", [rows[0].request_booking]),
    ).rejects.toThrow(/only the operator/i);
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
