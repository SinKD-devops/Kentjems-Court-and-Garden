# Kentjems Court and Garden

Booking app for one outdoor court (hourly) and one garden (event packages),
in Cebu. Installable to the home screen on Android and iOS.

Full design in [SPEC.md](SPEC.md).

## Running it

```bash
cp .env.example .env.local   # fill in the values
npm install
npm run db:push              # apply migrations
npm run db:seed              # spaces, hours, rates, packages, settings
npm run dev
```

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server on :3000 |
| `npm run build` | Production build |
| `npm test` | Schema and booking-rule tests (needs `DATABASE_URL`) |
| `npm run db:push` | Apply pending migrations |
| `npm run db:seed` | Re-seed reference data (idempotent) |

Tests skip rather than fail when `DATABASE_URL` is absent.

## Supabase settings that are not in this repo

Two things live in the Supabase dashboard and have to be set by hand.

### 1. Turn on phone sign-in

**Authentication → Sign In / Providers → Phone** → enable.

Without this, `signInWithOtp` refuses and nobody can sign in.

### 2. Route OTP through PhilSMS

Supabase's built-in phone auth only speaks to Twilio, MessageBird, Vonage and
TextLocal. PhilSMS is not among them, so delivery goes through an auth hook
instead — which is what keeps OTP and booking notifications on one provider,
one bill, and one deliverability profile.

**Authentication → Hooks → Send SMS**

- URI: `https://<your-domain>/api/auth/sms-hook`
- Copy the generated secret into `SUPABASE_SMS_HOOK_SECRET`

The endpoint lives at [src/app/api/auth/sms-hook/route.ts](src/app/api/auth/sms-hook/route.ts).
It verifies the Standard Webhooks signature and rejects anything older than
five minutes, since every accepted call spends SMS credit.

**Supabase cannot reach `localhost`,** so this hook only works once deployed.
For local development use **Authentication → Sign In / Providers → Phone →
Test OTP** to register a number and a fixed code. No SMS is sent and no credit
is spent.

### Before launch

Send yourself an OTP on **both Globe and Smart**. Deliverability varies by
provider and network, and it matters far more than the per-message price.

## How it fits together

**Availability is derived, never stored** — opening hours minus closures minus
live bookings, computed per request. Nothing to invalidate when a payment is
confirmed, and no cached grid can send someone to the store for a slot that
already sold.

**Double-booking is prevented by Postgres**, not by application code: an
exclusion constraint on `bookings` makes confirmed and awaiting-review
bookings mutually exclusive per space, while leaving requests free to overlap.
Requests are *meant* to overlap — until money changes hands the slot belongs
to nobody.

**Booking rules live in `request_booking`**, a SECURITY DEFINER function.
Opening hours, the advance window, the open-request limit, pricing and expiry
are evaluated in the same transaction as the insert, so there is no gap
between "is this allowed?" and "do it".

**Expiry is computed, not scheduled.** The `pg_cron` sweep is housekeeping.
Availability queries treat an expired request as dead, and `request_booking`
retires the caller's own stale requests before counting — so a late or failed
sweep can never lock a customer out.

**Live updates ride an availability pulse.** Subscribing to `bookings`
directly cannot work: RLS hides other customers' rows, and relaxing it would
expose names and phone numbers, because RLS filters rows and not columns. A
trigger bumps a per-space counter instead, which is safe for anyone to read,
and clients refetch through the public views when it moves.

**Times are Asia/Manila throughout.** The Philippines has not observed daylight
saving since 1978, so slot boundaries use a fixed `+08:00` offset. Timestamps
are stored UTC and rendered Manila.

**Money is integer centavos.** Never floats.

## SMS hook (Postgres function)

OTP is delivered by `public.send_sms_hook`, a Postgres function that calls
PhilSMS directly. Supabase's Send SMS hook accepts either an HTTPS endpoint or
a Postgres function; the function needs no public URL, so it works against a
localhost dev server and before anything is deployed.

Register it at **Authentication → Hooks → Send SMS → Postgres function**, and
select `public.send_sms_hook`. It lives in `public` because the dashboard's
hook picker does not enumerate custom schemas — the grants are the security
boundary: only `supabase_auth_admin` can execute it.

Credentials come from Vault, not from `process.env` — a Postgres function
cannot read the app's environment:

```bash
npm run db:secrets   # copies PHILSMS_* from .env.local into Vault
```

Re-run that after rotating a token.

`http` is used rather than `pg_net` on purpose. pg_net is fire-and-forget, so a
rejected send would still report success and the customer would watch a phone
that never buzzes. The synchronous call turns a failure into an error they
actually see. The call is capped at 8 seconds so a PhilSMS outage cannot pin a
database connection.

`PHILSMS_SENDER_ID` must be a sender ID approved on your PhilSMS account.
There is no API to list them — check the PhilSMS dashboard.
