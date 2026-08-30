# Kentjems Court and Garden — handover

Everything a new session needs to continue this project. Read this first, then
[SPEC.md](SPEC.md) for the original design reasoning.

Last updated: 30 August 2026.

Repo: `SinKD-devops/Kentjems-Court-and-Garden` (private)
Live: `https://kentjems-court-and-garden.vercel.app` (Vercel project is named
**kentjems-co** — the names differ, which has caused confusion twice)

---

## 0. Read this first if you are a new session

The project is finished and working except for SMS delivery, which is blocked
on one thing outside the code (§7.1). Do not start by rewriting anything —
read §4 before touching the SMS path, because every trap there was found the
expensive way.

---

## 1. What this is

A booking app for a venue in **Butuan City**: one outdoor court and one garden,
both booked by the hour. Installable to the home screen on Android and iOS.
Customers sign in by phone, request a time, and pay either at Kentjems Store in
cash or online by InstaPay/GCash QR. One operator approves everything.

**Two operator accounts exist**, both with `role = 'operator'`: the owner on
`09958192317` and Lordes Cubillas on `09502361590`, created 29 August 2026 as
the recovery path — a single operator is one lost SIM away from being unable to
approve payments. Neither can sign in until SMS works (§7.1), because OTP is
the only way in.

`profiles.is_backup_admin` is **not** the mechanism and grants nothing:
`is_operator()` checks `role` alone, so the flag is read by no policy,
view or function. Use `role = 'operator'`. See §9.

### The business rules that shape everything

| | |
|---|---|
| Court | PHP 60/hour 06:00–18:00, PHP 100/hour 18:00–24:00, 7 days ahead |
| Garden | PHP 250/hour 06:00–18:00, PHP 350/hour 18:00–24:00, 30 days ahead |
| Hours | 06:00–24:00 daily, both spaces |
| Requests | Not held. Expire in 30 minutes. One open request **per space** |
| Online payment | Accepted 06:00–23:00, last proof 22:30 |
| Cancellations | None, except weather or power, approved by the operator |
| Payee | Lordes Cubillas, 0950 236 1590 |
| Support numbers | 0950 236 1590, 0995 819 2317 |

### Status

**Working and verified against the live database:** booking, multi-hour
selection, cash at the counter, walk-ins, online payment with operator review,
move, refund, reports, settings, realtime updates, weather, the counter
console, and the PWA manifest and icons.

**48 tests pass.** `npm test`.

**Blocked:** all SMS. See §7.

**Never tested:** payment screenshot upload (needs a real file picker) and PWA
home-screen install. Both need a physical phone.

---

## 2. Running it

```bash
cp .env.example .env.local   # then fill in — see §6
npm install
npm run db:push              # apply migrations
npm run db:seed              # spaces, hours, rates, settings
npm run dev
```

| Command | Does |
| --- | --- |
| `npm test` | 48 tests; skip silently without `DATABASE_URL` |
| `npm run db:push` | Apply pending migrations |
| `npm run db:seed` | Re-seed reference data (idempotent) |
| `npm run db:secrets` | Copy secrets from `.env.local` into Supabase Vault |
| `npm run icons` | Regenerate app icons from SVG |
| `npm run vercel:env` | Push env vars to Vercel (needs `vercel login && vercel link`) |

**Windows note:** Node lives at `C:\Program Files\nodejs` and is often not on
the tool PATH. Prefix commands with
`$env:Path = "C:\Program Files\nodejs;" + $env:Path;` in PowerShell.

**Supabase connection** uses the Seoul pooler
(`aws-0-ap-northeast-2.pooler.supabase.com:5432`, user `postgres.<ref>`,
`sslmode=no-verify`). The direct `db.<ref>.supabase.co` host is IPv6-only and
does not resolve from here.

---

## 3. Architecture — the decisions that matter

### Availability is derived, never stored

Opening hours for the date, minus closures, minus live bookings, computed per
request in `src/lib/availability.ts`. Nothing to invalidate when a payment is
confirmed, and no cached grid can send someone to the store for an hour that
already sold. Every page that shows availability is `force-dynamic`.

### Double-booking is prevented by Postgres, not application code

```sql
alter table bookings add constraint no_live_overlap
  exclude using gist (space_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status in ('confirmed', 'proof_submitted'));
```

Requests are *allowed* to overlap — that is the whole race-to-pay design.
Only live bookings are exclusive. A submitted payment proof counts as live,
because the customer's money has already moved. There is a test that races two
transactions at one slot and asserts exactly one survives.

### Booking rules live in one Postgres function

`request_booking(space_slug, starts_at, accept_terms, hours)` evaluates opening
hours, the advance window, the open-request limit, pricing and expiry **in the
same transaction as the insert**. There is no gap between "is this allowed?"
and "do it" for a concurrent request to slip through. Do not move these checks
into TypeScript.

### Expiry is computed, not scheduled

The `pg_cron` sweep is housekeeping. Availability queries treat an expired
request as dead, and `request_booking` retires the caller's own stale requests
before counting — so a late or failed sweep can never lock a customer out.

### Realtime rides a pulse counter

Screens subscribe to `availability_pulse`, not to `bookings`. RLS hides other
customers' rows, so a direct subscription would deliver nothing, and relaxing
the policy would leak names and phone numbers — RLS filters rows, not columns.
Triggers on `bookings`, `payments` and `refunds` bump a per-space counter;
clients see it move and refetch through views they are allowed to read.

`<LiveAvailability />` with no `spaceId` watches everything (counter console);
with one, it watches a single space (customer grid).

### Time is Asia/Manila everywhere

The Philippines has no daylight saving, so slot boundaries use a fixed `+08:00`
offset (`src/lib/time.ts`). Timestamps are stored UTC and rendered Manila.
**Nothing reads `process.env.TZ`** — relying on a process timezone is how slots
land on the wrong date when a server moves region. Vercel also rejects `TZ` as
a variable name.

### Money is integer centavos

Never floats. `formatPeso()` for screens, `smsPesos()` for SMS (see §4).

### Two ways in: a code, or a password

Added 30 August 2026, because SMS is a third party that has already failed this
project once. A customer can sign in with a texted code (the default) or with a
password they have set.

**Registering still needs one code.** A password cannot be the first thing an
account has: a phone number nobody has verified is a number anybody could
claim, and whoever claimed it would receive that person's bookings. So the SMS
dependency has moved from *every* sign-in to *once per customer, ever* — it is
not gone. During an SMS outage an existing customer can still get in; a brand
new one cannot self-register, and has to be created at the counter.

**A password is required, at account creation.** Verifying a code checks
`profiles.password_set_at`; if it is null the customer lands on
`/account?first=1` before going anywhere else, with no way past it. A fallback
set after the first outage is a fallback that was missing when it mattered.

Enforced in **three** places, because a screen with the button removed is still
walked away from with the back button:

| Where | Why |
|---|---|
| After `verifyOtp` | The normal path — offered the moment the account exists |
| `/book` page load | Backstop. Rides on the profile read already there, so it costs no round trip |
| `createRequest` action | The real gate. A form can be posted without ever loading `/book` |

Signing in **with a password** stamps the column if it is null. Without that, an
operator whose password was set from the Supabase dashboard would be marched to
a screen telling them to set the one they had just used.

The cost is accepted deliberately: someone reaches this mid-booking with a slot
they want and a request that expires in thirty minutes, and some of them will
leave. That was weighed against being unable to trade during an SMS outage, and
the outage won.

**Recovery is the counter, not an email.** Forgotten password → sign in with a
code and set a new one at `/account`. If texts are not arriving at all, that
route is closed too, so the operator resets it with the admin API — verified
working. This is the only escape from an otherwise circular fallback: a
password whose reset path is the very channel it exists to survive.

**The wrong-credentials message is vague on purpose.** It never says whether
the number has an account. Philippine mobile numbers are `09` plus nine digits,
so the usernames are enumerable; a precise error turns the sign-in form into a
way to ask who is a customer here.

Rules live in `src/lib/password.ts` — eight characters, and not the phone
number. **Real strength enforcement is a Supabase dashboard setting**, not
code: leaked-password checking against HaveIBeenPwned and a project-wide
minimum, under Authentication → Policies. Until those are on, nothing stops
`password123`. See §7.

### Notifications are SMS only

Web push was removed on 29 August 2026. It had exactly one sender — the
T-10-minute expiry reminder — while every event where money had moved already
went out by SMS alone, so removing it cost one feature rather than a channel.
The reminder was dropped rather than converted: SPEC estimated it at roughly a
third of all message volume, which made it the most expensive notification in
the system and the only one not tied to a payment. A customer who forgets now
loses the slot without warning; the countdown is still on screen in `/my`.

Gone with it: `web-push`, the VAPID variables, `push_subscriptions`,
`expiry_reminded_at`, the `expiry-reminders` cron job and endpoint, and the
service worker's push handlers. `public/sw.js` still caches the app shell and
the offline page — that is unrelated and stays.

### The court asks what it is for, and declines two answers

A booking for the **court** must pick a purpose: pickleball, badminton,
volleyball, cheerdance, practice or basketball. Cheerdance and practice are
declined with a polite message carrying the support numbers, read from
`settings.support_numbers` rather than hardcoded. The garden does not ask —
it is booked for events, not sports.

Both declined options are **deliberately still shown**. Hiding them leaves
someone who wants the court for cheerdance guessing why their activity is
missing; offering them means a real answer and a number to call. Do not
"optimise" this by removing them from the list or greying them out.

The check is in `request_booking`, not TypeScript — same transaction as the
insert, same rule as everything else in §9. `src/lib/purposes.ts` carries the
labels only; if it and the database disagree, the database wins and the
customer sees "Please choose what the court is for."

Stored in `bookings.event_type`, which had sat unused since the initial schema,
and surfaced in the counter console and the booking detail screen through
`operator_schedule.purpose`.

**A refusal leaves no trace.** The exception rolls the transaction back, so
there is no record of how many people asked for cheerdance or practice. If that
demand is worth knowing, it needs a separate log table — the current design
cannot tell you.

### Payment screenshots are compressed in the browser

`compressImage()` in `src/lib/image.ts` re-encodes a proof to a 1600px JPEG
before upload — roughly 400 KB from a 3–8 MB screenshot. Mobile data in the
Philippines is not free, and the operator only ever reads the reference number
and amount off the image.

Every failure path returns the **original file** rather than throwing. HEIC is
the real case: Safari decodes it, most Android browsers do not, so those go up
uncompressed. That is why the bucket cap is 10 MB rather than the ~1 MB a
compressed proof needs — it is headroom for the undecodable, not the target.
A proof that uploads slowly is a slow upload; a proof that cannot upload is a
customer who has already sent money and cannot show it.

---

## 4. Traps found the hard way

Each of these cost real debugging time. They are the most valuable part of this
document.

**A provider saying "Delivered" does not mean delivered.** PhilSMS reported
`status: Delivered` and charged a credit for every message, including ones that
demonstrably never arrived. It marks messages delivered on *submission*. Never
treat a provider's success response as proof.

**Semaphore reports rejection as HTTP 200** with an array of field errors. The
code checks for a `message_id` in the response rather than trusting the status.
Trusting the status is exactly how the previous provider's failures stayed
invisible for a day.

**Phone numbers must be normalised centrally.** Supabase stores them without a
leading plus (`639958192317`), walk-ins are typed locally (`0917 123 4567`).
Normalisation lives inside `sendSms`, not at call sites, so a new caller cannot
reintroduce the bug by forgetting. This bug silently sent nothing for hours.

**SMS must stay inside the GSM alphabet.** A single `₱`, en dash or curly quote
forces Unicode encoding, cutting the limit from 160 characters to 70 — one
character can triple the cost. `gsmSafe()` strips them on the way out, and
`tests/sms-copy.test.ts` asserts every message fits in one part.

**Philippine carriers filter on scam vocabulary.** The sign-in message must not
contain *code*, *OTP*, *verify*, *PIN*, *password*, links, capitals or urgency
language. It now reads *"Kentjems Court and Garden. Your number is 216220. It
works for the next 5 minutes."*

**A byte order mark can hide a variable.** PowerShell redirection wrote a BOM
into `.env.local`, making the variable literally `\uFEFF` + its name. Nothing
read it and nothing failed. The Vercel push script now refuses invalid names.
(It happened to a VAPID key, which no longer exists \u2014 the lesson does.)

**Env vars only apply to new Vercel builds.** Adding them without redeploying
changes nothing. Symptom: `{"error":"CRON_SECRET is not set."}` from
`/api/cron/sms-balance`, which is the quickest way to check production.

**Restart the dev server after changing `.env.local`.** Next reads env files
only at startup. A stale dev server silently sent no SMS for an hour.

**Read the profile with the caller's session, not the anon client.** RLS limits
profiles to their owner, so the anonymous client returns nothing — which made
the terms checkbox reappear on every booking.

**Rejected payments must not hold a reference number forever.** The unique
index on `payments.reference_number` excludes rejected rows, or a customer
rejected for an unreadable screenshot could never resubmit a genuine payment.

**The privilege guard blocks operator bootstrap.** `guard_profile_privileges`
allows `postgres`/`service_role` through precisely so the first operator can be
created; a customer session is never either.

**`is_backup_admin` looks like a privilege and is not one.** The column is
guarded by `guard_profile_privileges` as though it grants operator rights, and
its own comment describes it as the second operator-capable account — but
`is_operator()` selects on `role` alone, so no policy, view or function ever
reads the flag. Setting it succeeds and grants nothing. The failure only
surfaces the day someone flips it during a real lockout and finds the account
still cannot approve a payment. Promote with `role = 'operator'`.

**Latency:** measured 30 August 2026 — **2.0–4.1s TTFB in production**, 0.4–0.6s
warm on localhost. The older "~1.7s" figure in this document was optimistic.
Vercel runs functions in Washington (`iad1`, fixed on the Hobby plan) while the
database is in Seoul. Moving the database to **Singapore would make it worse** —
the function-to-database hop gets longer. The free fix is moving the database to
**US East**; the paid fix is Vercel Pro with functions pinned to `icn1`.
Accepted for now.

**Changing date feels slow, and two separate things cause it.** The wait is
real: the grid is never cached, so every date is a fresh server render against
Seoul. Two sequential round trips remain — `listSpaces()` and then the
availability batch. What made it feel broken rather than slow was that nothing
moved for those seconds; the date chips now pulse while their own navigation is
in flight (`useLinkStatus`, `src/components/DateChipContent.tsx`).

Do not "fix" the remaining wait by prefetching or caching the grid. A prefetched
date is availability fetched seconds early, which is the stale grid §3 exists to
prevent.

---

## 5. Database

### Tables
`spaces`, `profiles`, `bookings`, `payments`, `refunds`, `booking_moves`,
`opening_hours`, `pricing_rules`, `closures`, `packages` (retired),
`settings` (singleton), `availability_pulse`, `sms_log`,
`schema_migrations`

### Booking statuses
```
requested → proof_submitted → confirmed → completed
     ↓            ↓                ↓
  expired     rejected      cancelled_refunded
  withdrawn
  superseded
```

### Views
| View | Purpose |
|---|---|
| `public_availability` | Taken ranges, no identities — safe for anonymous |
| `slot_demand` | Live unpaid requests per slot, drives "2 waiting" |
| `closure_windows` | Closure ranges flattened to timestamp columns |
| `operator_schedule` | Counter console feed |
| `payment_review_queue` | Pending proofs with mismatch/duplicate flags |
| `booked_hours` | One row **per booked hour** — a 3-hour booking makes 3 |
| `revenue_by_day`, `occupancy_by_hour` | Reports, built on `booked_hours` |
| `refunds_owed` | Approved refunds not yet handed back |
| `sms_deliveries` | pg_net responses (OTP path only) |

### Functions worth knowing
`request_booking`, `withdraw_booking`, `submit_payment_proof`,
`approve_payment`, `reject_payment`, `confirm_cash_payment`, `create_walk_in`,
`move_booking`, `approve_refund`, `settle_refund`, `price_centavos_for`,
`price_centavos_for_range`, `is_operator`, `send_sms_hook`,
`complete_past_bookings`, `expire_stale_requests`

`approve_payment`, `confirm_cash_payment` and `create_walk_in` all return the
bookings they superseded, so the caller can text those customers. Losing a
contested slot silently means walking to the store for a court that is gone.

### Scheduled jobs (pg_cron)
| Job | Schedule | What |
|---|---|---|
| `expire-stale-requests` | every minute | housekeeping only |
| `complete-past-bookings` | every 15 min | confirmed → completed |
| `purge-proofs` | 03:15 Manila | calls `/api/cron/purge-proofs`, 90-day retention |
| `sms-balance-check` | 08:00 Manila | calls `/api/cron/sms-balance`, warns below PHP 50 |

The three that call the app go through `pg_net` using `app_url` and
`cron_secret` from Vault. **If `app_url` is `localhost` they run every minute
and silently reach nothing** — visible as `Couldn't connect to server` rows in
`net._http_response`.

---

## 6. Environment variables

In `.env.local` (gitignored) and Vercel. `.env.example` lists the names.

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel type: Config, not secret |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Config — ships to browsers by design |
| `NEXT_PUBLIC_SITE_URL` | Config — must be the real URL, not localhost |
| `SUPABASE_SECRET_KEY` | secret — bypasses all RLS |
| `SEMAPHORE_API_KEY` | secret |
| `SEMAPHORE_API_URL` | `https://api.semaphore.co/api/v4` |
| `SEMAPHORE_SENDER_NAME` | **empty — blocking, see §7** |
| `CRON_SECRET` | secret |
| `DATABASE_URL` | **local only, never in Vercel** — superuser connection |

Vercel rejects `TZ`. `npm run vercel:env` pushes everything except
`DATABASE_URL` and reserved names, and refuses to run while
`NEXT_PUBLIC_SITE_URL` is localhost.

After changing SMS or URL settings, run `npm run db:secrets` so Vault (used by
the database functions) matches.

---

## 7. Blockers, in priority order

**1. Semaphore has no approved sender name.** Every send is refused with
*"No active sender name found."* Tried omitting it, `SEMAPHORE`, `Kentjems` —
all rejected. The owner was applying for one. When approved: put it in
`.env.local` as `SEMAPHORE_SENDER_NAME`, run `npm run db:secrets`, add it to
Vercel, then test delivery to a **Smart/TNT** number (09635483047), not just
Globe. *No SMS works until this is done.*

Since 30 August 2026 this is no longer a total lockout: password sign-in exists
(§3), so anyone whose account already has a password can use the app now. What
is still blocked is **self-registration** — a new customer needs one code to
verify their number, so until this clears, new customers must be created at the
counter with the admin API.

**1b. Password strength is not enforced yet.** Turn on leaked-password
protection and a minimum length in the Supabase dashboard, under
Authentication → Policies. `src/lib/password.ts` checks length and rejects the
phone number, but only the dashboard setting stops a known-breached password.
This matters more now that a password alone opens an account that can hold
bookings.

Why the switch: PhilSMS delivered to Globe (0995, 0950) and silently not at all
to Smart/TNT (0963, 0947), while charging for every message. Four people
requested a sign-in message and got nothing. Semaphore covers all networks.
PhilSMS credit (~PHP 260) is still alive as a fallback, but its secrets have
been removed from Vault — restoring it means re-running `npm run db:secrets`
with the PhilSMS values and reverting migration 20260828002400.

**2. Vercel environment — mostly resolved, but the deploy is stale.** Checked
30 August 2026:
`curl -X POST https://kentjems-court-and-garden.vercel.app/api/cron/sms-balance`
returns `401`, not `500`, so `CRON_SECRET` is set. The live site also renders
real availability, which means the public Supabase variables are baked into the
build. **Not proven by either check:** `SEMAPHORE_API_KEY` and
`SUPABASE_SECRET_KEY`, and whether any of them were updated after the
credential rotation.

What is still outstanding is the **deploy**, not the variables. A `git push` to
`main` does **not** trigger a build — there is no GitHub auto-deploy on this
project, confirmed by `/api/cron/expiry-reminders` still answering `401` after
its route was deleted and pushed. Deploy by hand:

```bash
vercel login && vercel link && vercel --prod
```

Until that runs, the deployed code is older than both the repository and the
database — the schema has already dropped the push objects while the live build
still contains the route that used them. Harmless only because the `pg_cron`
job that called it is unscheduled, so nothing invokes it.

**3. Rotate credentials.** The database password and Supabase secret key were
both pasted into a chat transcript.

**4. Supabase free tier pauses after ~1 week idle.** A paused database means
nobody can book, silently, on a quiet week. ~$25/month.

**5. Untested paths** — screenshot upload and home-screen install. Both need a
physical phone.

---

## 8. Screens

**Customer:** `/` slot grid · `/book` confirm · `/pay/[id]` online payment ·
`/my` bookings · `/account` set a password · `/sign-in` (add `?mode=password`
for the password form) · `/offline`

**Operator** (`profiles.role = 'operator'`, no link from the customer app —
type `/admin`): `/admin` today · `/admin/payments` review queue ·
`/admin/walk-in` · `/admin/customers` search all bookings ·
`/admin/reports` 30 days · `/admin/refunds` owed · `/admin/settings` ·
`/admin/booking/[id]` move and refund

**API:** `/api/auth/sms-hook` (unused — the OTP hook is a Postgres function
instead) and three `/api/cron/*` endpoints guarded by `CRON_SECRET`.

### Design
Green `#12724D` (deep enough for 4.5:1 on white — outdoor readability), system
fonts, glass only on the top and bottom bars (blurring 18 slot tiles stutters
on budget Android). Slot state is carried by depth: available is raised,
contested is tinted, booked flattens, past has no card. **Only one fixed bottom
bar** — the grid owns it and swaps between the day summary and the selection,
because two translucent bars showed through each other.

---

## 9. If you change one thing, know this

- Don't move booking validation out of `request_booking`.
- Don't cache availability, anywhere.
- Don't subscribe to `bookings` for realtime — use the pulse.
- Don't trust an SMS provider's success response.
- Don't put `₱` or a dash in an SMS.
- Don't grant operator rights with `is_backup_admin` — nothing reads it.
  Set `role = 'operator'`.
- Do restart the dev server after touching `.env.local`.
- Do run `npm test` — the concurrency and pricing tests are the ones that
  catch real breakage.
