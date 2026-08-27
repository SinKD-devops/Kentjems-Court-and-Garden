import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Schema guarantees for Kentjems Court and Garden.
 *
 * The centrepiece is the concurrency test: two clients race to confirm the
 * same slot inside real, simultaneous transactions. Exactly one must win.
 * This is the only test here that could not be replaced by reading the
 * migration file — everything else is a sanity check, this is the proof.
 *
 * Requires DATABASE_URL in .env.local (Supabase → Settings → Database →
 * Connection string → URI). Run with: npm run test:db
 */

const DATABASE_URL = process.env.DATABASE_URL;

// A slot far in the future so it can never collide with real data.
const SLOT_START = "2099-06-15T19:00:00+08";
const SLOT_END = "2099-06-15T20:00:00+08";
const TEST_PHONE = "09999999999";

let courtId: string;
let admin: Client;

async function connect() {
  const c = new Client({ connectionString: DATABASE_URL });
  await c.connect();
  return c;
}

async function cleanup(c: Client) {
  await c.query(`delete from bookings where contact_phone = $1`, [TEST_PHONE]);
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  admin = await connect();
  const { rows } = await admin.query(`select id from spaces where slug = 'court'`);
  courtId = rows[0]?.id;
  await cleanup(admin);
});

afterAll(async () => {
  if (!DATABASE_URL) return;
  await cleanup(admin);
  await admin.end();
});

describe.skipIf(!DATABASE_URL)("booking overlap guard", () => {
  it("allows two REQUESTS to overlap — the race is the design", async () => {
    const insert = `
      insert into bookings
        (space_id, starts_at, ends_at, status, price_centavos, source, contact_phone, expires_at)
      values ($1, $2, $3, 'requested', 10000, 'walk_in', $4, now() + interval '30 minutes')
      returning id`;

    const a = await admin.query(insert, [courtId, SLOT_START, SLOT_END, TEST_PHONE]);
    const b = await admin.query(insert, [courtId, SLOT_START, SLOT_END, TEST_PHONE]);

    expect(a.rows[0].id).toBeTruthy();
    expect(b.rows[0].id).toBeTruthy();
    await cleanup(admin);
  });

  it("lets exactly one of two CONCURRENT confirmations win", async () => {
    const one = await connect();
    const two = await connect();

    const insertConfirmed = `
      insert into bookings
        (space_id, starts_at, ends_at, status, price_centavos, source, contact_phone)
      values ($1, $2, $3, 'confirmed', 10000, 'walk_in', $4)`;
    const args = [courtId, SLOT_START, SLOT_END, TEST_PHONE];

    try {
      await one.query("begin");
      await two.query("begin");

      // Client one takes the slot but has NOT committed yet.
      await one.query(insertConfirmed, args);

      // Client two attempts the same slot. Postgres blocks it here rather
      // than failing immediately — it cannot know the outcome until the
      // first transaction resolves. This is precisely the window in which
      // an application-level "is it free?" check would let both through.
      const contender = two.query(insertConfirmed, args);

      await one.query("commit");

      await expect(contender).rejects.toMatchObject({ code: "23P01" });
      await two.query("rollback");

      const { rows } = await admin.query(
        `select count(*)::int as n from bookings
         where space_id = $1 and starts_at = $2 and status = 'confirmed'`,
        [courtId, SLOT_START],
      );
      expect(rows[0].n).toBe(1);
    } finally {
      await one.end();
      await two.end();
      await cleanup(admin);
    }
  });

  it("treats a submitted GCash proof as holding the slot", async () => {
    await admin.query(
      `insert into bookings
         (space_id, starts_at, ends_at, status, price_centavos, source, contact_phone)
       values ($1, $2, $3, 'proof_submitted', 10000, 'walk_in', $4)`,
      [courtId, SLOT_START, SLOT_END, TEST_PHONE],
    );

    await expect(
      admin.query(
        `insert into bookings
           (space_id, starts_at, ends_at, status, price_centavos, source, contact_phone)
         values ($1, $2, $3, 'confirmed', 10000, 'walk_in', $4)`,
        [courtId, SLOT_START, SLOT_END, TEST_PHONE],
      ),
    ).rejects.toMatchObject({ code: "23P01" });

    await cleanup(admin);
  });

  it("frees the slot again once a booking is rejected", async () => {
    const held = await admin.query(
      `insert into bookings
         (space_id, starts_at, ends_at, status, price_centavos, source, contact_phone)
       values ($1, $2, $3, 'proof_submitted', 10000, 'walk_in', $4) returning id`,
      [courtId, SLOT_START, SLOT_END, TEST_PHONE],
    );

    await admin.query(`update bookings set status = 'rejected' where id = $1`, [
      held.rows[0].id,
    ]);

    const after = await admin.query(
      `insert into bookings
         (space_id, starts_at, ends_at, status, price_centavos, source, contact_phone)
       values ($1, $2, $3, 'confirmed', 10000, 'walk_in', $4) returning id`,
      [courtId, SLOT_START, SLOT_END, TEST_PHONE],
    );
    expect(after.rows[0].id).toBeTruthy();
    await cleanup(admin);
  });
});

describe.skipIf(!DATABASE_URL)("payment references", () => {
  it("refuses to let one GCash reference pay for two bookings", async () => {
    const mk = async () => {
      const { rows } = await admin.query(
        `insert into bookings
           (space_id, starts_at, ends_at, status, price_centavos, source, contact_phone)
         values ($1, $2, $3, 'requested', 6000, 'walk_in', $4)
         returning id`,
        [courtId, "2099-06-16T08:00:00+08", "2099-06-16T09:00:00+08", TEST_PHONE],
      );
      return rows[0].id;
    };

    const first = await mk();
    await admin.query(
      `insert into payments (booking_id, method, amount_centavos, reference_number)
       values ($1, 'gcash', 6000, '0027441983062')`,
      [first],
    );

    const second = await mk();
    await expect(
      admin.query(
        `insert into payments (booking_id, method, amount_centavos, reference_number)
         values ($1, 'gcash', 6000, '0027441983062')`,
        [second],
      ),
    ).rejects.toMatchObject({ code: "23505" });

    await cleanup(admin);
  });
});

describe.skipIf(!DATABASE_URL)("pricing in Manila time", () => {
  const price = async (iso: string) => {
    const { rows } = await admin.query(
      `select price_centavos_for($1, $2::timestamptz) as p`,
      [courtId, iso],
    );
    return rows[0].p;
  };

  it("charges the day rate through the 5pm slot", async () => {
    expect(await price("2026-09-01T06:00:00+08")).toBe(6000);
    expect(await price("2026-09-01T17:00:00+08")).toBe(6000);
  });

  it("charges the evening rate from 6pm", async () => {
    expect(await price("2026-09-01T18:00:00+08")).toBe(10000);
    expect(await price("2026-09-01T23:00:00+08")).toBe(10000);
  });

  it("reads the boundary in Manila time, not UTC", async () => {
    // 18:00 Manila is 10:00Z. If the rule were evaluated against the UTC
    // clock this would come back as the day rate and every evening booking
    // would be underpriced by PHP 40.
    expect(await price("2026-09-01T10:00:00Z")).toBe(10000);
  });
});
