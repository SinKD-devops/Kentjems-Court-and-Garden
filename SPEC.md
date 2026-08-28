# Kentjems Court and Garden — Booking App Spec

> **This is the original design document.** It records why the system is shaped
> the way it is, which is still worth reading. Where it disagrees with what was
> actually built, [HANDOVER.md](HANDOVER.md) is the current truth — it is
> maintained; this is not rewritten wholesale.
>
> Corrected below where the design moved during the build: the garden is booked
> by the hour rather than in packages, bookings can span consecutive hours, SMS
> goes through Semaphore rather than PhilSMS, and the Cebuano translation was
> dropped. The venue is in Butuan City.

Installable web app (PWA) for booking one outdoor court and one garden space.
Payment is cash over the counter at Kentjems Store. Single operator.

## Stack
Next.js (App Router) + Supabase (Postgres, phone OTP auth, realtime) on Vercel.
English only. A Cebuano toggle was planned and dropped during the build;
next-intl was removed rather than left implying a feature that is not coming.
Timezone: Asia/Manila. Timestamps STORED IN UTC, RENDERED in Manila time. The 17:00
rate boundary and the 24:00 day boundary make this a real correctness issue, not
boilerplate — a tz bug puts slots on the wrong date.

## Spaces

| | Court | Garden |
|---|---|---|
| Booking mode | Hourly, 1–12 consecutive hours | Hourly, 1–12 consecutive hours |
| Hours | 6:00–24:00 (18 slots/day) | 6:00–24:00 (18 slots/day) |
| Day rate | PHP 60/hr, 06:00–18:00 | PHP 250/hr, 06:00–18:00 |
| Evening rate | PHP 100/hr, 18:00–24:00 | PHP 350/hr, 18:00–24:00 |
| Advance window | 7 days | 30 days |
| Open requests per user | 1 (per space) | 1 (per space) |
| Extra fields | — | — (packages retired; the garden is hourly) |

Fully independent timelines. Max court revenue/day: (12 x 60) + (6 x 100) = PHP 1,320.
Rates are for the WHOLE COURT, not per person. No headcount field on court bookings.
The request limit is PER SPACE: a pending garden event must not block a court booking.

Packages were retired when the garden moved to hourly booking. The `packages`
table remains because bookings reference it, and dropping it would break
history.


## Core mechanic: request, then race to pay

Slots are NEVER held. Booking online creates a REQUEST. First to pay at the store wins.

    requested --30 min--> expired
        |
        +-- user cancels --------> withdrawn
        +-- someone else pays ---> superseded   (auto, notified)
        +-- operator marks paid -> confirmed --> completed
                                       |
                                       +-------> cancelled_refunded
                                                 (rain / power outage,
                                                  operator approval,
                                                  cash refund at store)

### Rules
- Requests MAY overlap. Only confirmed bookings are exclusive.
- Expiry = min(now + 30 min, store closing 24:00). If that leaves < 10 min,
  block the request and tell the user to come tomorrow.
- Confirming a booking auto-supersedes all competing requests for that range,
  and notifies those users.
- One open request PER SPACE, not one overall.
- The operator can MOVE a booking to another free slot in the same space
  (paid status and payment record carry over; customer is notified). This is
  the pressure valve for a no-cancellation policy — use it instead of refunds.
- NO-SHOWS: no policy, no tracking. Paid is paid, the slot goes unused.
- TERMS must be TICKED at first booking, not buried: "No cancellations or
  refunds except weather or power interruptions approved by the operator."
  Store accepted_terms_at on the profile.
- No cancellations by customers. Only operator-approved force majeure
  (rain — the court is outdoor and uncovered — or a power interruption during
  the 18:00–24:00 lit hours), settled as a cash refund at the store.

### Database guard
Overlap prevention lives in Postgres, not app code:

    CREATE EXTENSION IF NOT EXISTS btree_gist;

    ALTER TABLE bookings ADD CONSTRAINT no_live_overlap
      EXCLUDE USING gist (
        space_id WITH =,
        tstzrange(starts_at, ends_at) WITH &&
      ) WHERE (status IN ('confirmed', 'proof_submitted'));

proof_submitted was added when online payment arrived: once the money has
left the customer's account the slot is held, because there is no refund API.

### Expiry is computed, not scheduled
Availability queries treat `status='requested' AND expires_at < now()` as dead.
A pg_cron sweep every minute is housekeeping only — never the source of truth.

### Live updates
Supabase realtime on `availability_pulse`, a per-space counter bumped by
triggers on bookings, payments and refunds. NOT on `bookings` directly: RLS
hides other customers' rows so a direct subscription delivers nothing, and
relaxing it would leak names and numbers because RLS filters rows, not columns.
Confirming at the counter darkens the slot on every open phone within ~1s.

## Data model
- spaces          — court, garden; both booking_mode hourly
- bookings        — space_id, user_id, starts_at, ends_at, status, price,
                    expires_at, event_type, needs_tables, needs_sound, source
- packages        — retired; kept because bookings reference it
- pricing_rules   — space_id, day_of_week, start_time, end_time, price
- opening_hours   — space_id, day_of_week, open, close
- closures        — space_id, range, reason (maintenance, blackout)
- profiles        — phone, name, role (customer | operator), accepted_terms_at,
                    is_backup_admin
- refunds         — booking_id, amount, reason, approved_by, settled_at
- settings        — expiry_minutes, advance_days per space, request limits,
                    gcash_window (06:00-23:00), last_submission_time,
                    support_numbers, gcash_qr_image
- booking_moves   — booking_id, from_range, to_range, moved_by, reason, moved_at

## Screens

### Customer
1. Space picker (Court / Garden)
2. Court: date strip + hourly slot grid, live availability, price per slot
3. Garden: same hourly grid, with a jump-to-date field for its 30-day window
4. Confirm — price, expiry warning, "Go to Kentjems Store now"
5. Active request — visible countdown, push at T-10min
6. My bookings — upcoming and past

### Operator (single account, phone-first counter console)
1. Today — both spaces, paid/unpaid at a glance
2. Pending queue — search by name/phone, one tap to mark paid
3. Walk-in entry — name, phone, slot, paid, done. MUST be the fastest path
   in the app; counter bookings will outnumber app requests early on.
4. Refunds — approve force-majeure cancellations
5. Reports — daily/weekly revenue, day vs evening split, occupancy by hour
6. Move booking — reassign a booking to another free slot, same space
7. Settings — hours, rates, payment window, payee details, closures
8. Find — search every booking by name or number, any date

ACCOUNTS & RECOVERY
Two operator-capable phone numbers, both able to approve payments and take
bookings: 0950 236 1590 and 0995 819 2317. A single-operator business logged in
by phone OTP is one lost SIM away from being unable to trade — the second number
is the recovery path, not a convenience.

SUPPORT CONTACT
The same numbers are shown in-app as the support contact, and MUST appear on the
payment-rejection screen. A rejected GCash proof with no way to reply becomes a
public complaint instead of a conversation.

## Notifications

Provider: **Semaphore** — about PHP 0.50/SMS, covers Globe, Smart, Sun and DITO.

It replaced PhilSMS during the build. PhilSMS was cheaper at PHP 0.35 and
delivered reliably to Globe, but silently never delivered to Smart or TNT while
still reporting "Delivered" and charging for every message. Four people
requested a sign-in message and received nothing. Cheaper per message is
meaningless if the message does not arrive.

Supabase native phone auth supports neither (only Twilio, MessageBird, Vonage
and TextLocal), so the sign-in message routes through Supabase's Send SMS hook,
implemented as a Postgres function calling the provider over pg_net. That is
what made the provider swap cost two files and one database function.

Message copy must survive Philippine carrier filtering and stay inside the GSM
alphabet. See §4 of HANDOVER.md before changing any of it.

### Push-first policy
Web push is free; SMS is not. Channel per event:

| Event                            | Channel           |
|----------------------------------|-------------------|
| OTP login                        | SMS (only option) |
| GCash payment APPROVED           | SMS + push        |
| GCash payment REJECTED           | SMS + push        |
| Counter (cash) payment confirmed | SMS + push        |
| Request superseded (lost slot)   | SMS + push        |
| Booking moved by operator        | SMS + push        |
| Request expiring (T-10 min)      | Push only         |
| Refund approved                  | Push only         |

Every outcome where MONEY HAS MOVED goes by SMS. Push alone is not enough: it
requires the app installed and notifications granted, and on iOS it only works
once added to the home screen. A customer who paid must be told the result
whether or not they installed anything.

SMS copy is short and complete on its own — a booking SMS must be actionable
without opening the app:
  APPROVED — "Kentjems: PAID. Court, Thu 28 Aug, 7-8PM. Ref 0027441983062.
              See you there."
  REJECTED — "Kentjems: payment not accepted (duplicate reference). Slot
              released. Call 0950 236 1590."

A rejection SMS MUST carry a support number. The customer believes they paid;
being told no with no way to reply is how this becomes a public complaint.

Estimated volume at full occupancy: ~1,500-2,000 SMS/month = PHP 525-700.
Keeping the expiry reminder push-only cuts roughly a third of message volume —
a larger saving than the choice of provider.

BEFORE LAUNCH: verify sign-in deliverability to both Globe and Smart using
Semaphore. Deliverability varies by vendor and matters far more than centavos —
this is exactly what PhilSMS got wrong.

## PWA / installability
- manifest.webmanifest: display standalone, start_url /, theme + background colors
- icons 192, 512, and a 512 maskable (Android crops non-maskable icons badly)
- apple-touch-icon 180x180 — iOS ignores manifest icons for the home screen
- Android: capture beforeinstallprompt, show custom install button AFTER a
  first successful booking, not on page load
- iOS: no install prompt exists. Custom bottom sheet detecting iOS Safari +
  not-standalone, showing Share -> Add to Home Screen
- Service worker: cache app shell + offline page ONLY.
  NEVER cache availability data — a stale grid sends someone to the store
  for a slot that sold ten minutes ago.
- Web push on iOS requires home-screen install, which makes the 30-minute
  countdown reminder a genuine reason to install.

## Payment methods

Two paths, both ending in operator approval. No payment gateway, no fees,
no merchant onboarding.

### Path 1 — Over the counter (cash at Kentjems Store)
Unchanged. Request, NO hold, 30-minute expiry, first to pay wins.
Operator marks paid at the counter.

### Path 2 — GCash QR (owner-provided static QR)
Customer pays to the owner's GCash QR, submits proof, operator approves.

    requested
       |
       | customer pays via GCash, submits proof
       v
    proof_submitted   <-- SLOT IS HELD from this moment
       |
       +-- operator approves --> confirmed
       +-- operator rejects  --> rejected (hold released, reason given)
       +-- operator inactive --> escalating reminders, hold persists

The slot IS held once proof is submitted. This differs from the cash path on
purpose: money has actually left the customer's account, and there is no refund
API here — an unwanted refund means the owner manually sending GCash back.
Holding on proof submission is what keeps that from happening.

### Screenshots are a claim, not proof
A screenshot is trivially faked. The app cannot verify payment; only the owner
can, against their own GCash transaction history. The system's job is to make
that check FAST and to make fraud detectable:

REQUIRED FIELDS on submission:
  - GCash reference number (13 digits), TYPED, not just visible in the image
  - Amount (pre-filled with the expected price, flagged if edited)
  - Screenshot image
  - Sender name / GCash account name

ANTI-FRAUD MEASURES:
  - UNIQUE INDEX on reference_number. The same reference cannot be reused for a
    second booking. This alone blocks the most likely abuse: recycling one
    payment screenshot across multiple slots.
  - Amount mismatch against expected price is flagged red in the review queue.
  - Reference numbers already seen are flagged as duplicates before the operator
    even opens the image.
  - Repeat rejections per phone number raise a trust flag on the profile.
  - Approval screen shows the expected amount beside the claimed amount, so the
    operator compares against GCash rather than against the screenshot.

The operator MUST verify against the real GCash app or SMS, not the screenshot.
This is stated in the UI, because a convincing fake will otherwise get approved.

### GCash acceptance window — 06:00 to 23:00
Proof submission is only accepted between 6am and 11pm. Outside that window the
GCash option is HIDDEN (not disabled-with-error), and the payment screen shows
only the counter option plus a line: "GCash payment reopens at 6:00 AM. Pay at
Kentjems Store, open until 12 midnight."

This is an OPERATOR-availability window, not a restriction on which slots can be
booked. A 11pm court slot is still bookable by GCash at 2pm.

Effect: holds no longer sit overnight awaiting approval, which removes the
worst case in this design — a customer paying at 1am and waiting until morning.

BUFFER: a proof submitted at 10:58pm still needs review before the window shuts.
Set last_submission_time as a separate setting (suggested 22:30) so the operator
has a margin. If a proof is still pending when the window closes, the hold
PERSISTS overnight and is reviewed from 6am — it is never auto-rejected, since
the money has genuinely been sent.

### Operator review queue
New proof triggers push + SMS to the operator immediately. The queue shows, per
item: slot, space, expected vs claimed amount, reference number, sender name,
screenshot thumbnail, duplicate/mismatch flags, and Approve / Reject.

Reject reasons (fixed list): unreadable, wrong amount, duplicate reference,
payment not found, other. The reason is sent to the customer.

Because a held slot sits idle while awaiting review, the operator gets reminders
at 30 min and 2 hours on pending proofs. Holds do NOT auto-expire — the delay is
the operator's, not the customer's, and auto-releasing a slot someone has paid
for creates exactly the refund mess this design avoids.

### Schema
The exclusion constraint widens to cover holds, or two people submit proof for
the same slot and both pay:

    ALTER TABLE bookings DROP CONSTRAINT no_confirmed_overlap;
    ALTER TABLE bookings ADD CONSTRAINT no_live_overlap
      EXCLUDE USING gist (
        space_id WITH =,
        tstzrange(starts_at, ends_at) WITH &&
      ) WHERE (status IN ('confirmed', 'proof_submitted'));

New table:
  payments — booking_id, method (cash | gcash), amount_centavos,
             reference_number (UNIQUE, nullable for cash), sender_name,
             proof_image_path, status, submitted_at, reviewed_at,
             reviewed_by, reject_reason

Amounts stored as INTEGER CENTAVOS. Never floats.

### Proof image storage
Supabase Storage, PRIVATE bucket, RLS so a customer reads only their own uploads
and the operator reads all. Client-side compression before upload (max ~1600px,
JPEG) — phone screenshots are large and mobile data in the Philippines is not
free. Enforce a size cap server-side.

RETENTION: screenshots contain financial details. Auto-delete images 90 days
after the booking completes; keep the payment row and reference number for
records. State this in a short privacy note.

### The remaining race
Cash and GCash can still collide — someone pays at the counter while a proof is
pending. The exclusion constraint prevents the double-confirm, and the operator
must then refund the loser by sending GCash back manually. Rare by design, but
the console needs a "refund owed" state so it is not forgotten.

### Honest limitations
- Manual review does not scale. At a few bookings a day it is fine; if the
  queue becomes a burden, PayMongo QR Ph (~1.34-1.5%, webhook-confirmed, fully
  automatic) is the upgrade path. Roughly PHP 600/month at full occupancy.
  The payments table above is shaped so that swap does not require a rewrite.
- Approval latency sits in the customer's critical path. Bounded by the
  06:00-23:00 acceptance window, so the worst case is a wait until 6am for a
  proof submitted just before closing, not an indefinite overnight hold.
  Set expectations in the UI: "usually approved within the hour."
- No automated reconciliation. Revenue reports reflect what the operator
  approved, not what GCash actually received. A weekly manual cross-check
  against the GCash statement is advisable.

### Business items
- Owner's static GCash QR image stored in settings, shown on the payment screen
  with the exact amount and a copy-able reference note.
- BIR receipting obligations apply to GCash collections as they do to cash.

## Visual design — Glassmorphism (Apple Liquid Glass)

Translucent, blurred, layered surfaces with specular edges. White and green core,
accents beyond green where they carry meaning.

### Tokens (light)
    --bg-mesh-1:    #DFF3E6   /* soft green, top-left */
    --bg-mesh-2:    #EAF6F0   /* pale mint, centre */
    --bg-mesh-3:    #CDE9DA   /* deeper green, bottom-right */
    --glass:        rgba(255, 255, 255, 0.55)
    --glass-thick:  rgba(255, 255, 255, 0.72)  /* sheets, modals */
    --glass-stroke: rgba(255, 255, 255, 0.75)  /* specular top edge */
    --glass-edge:   rgba(20,  70,  45, 0.08)   /* lower edge definition */
    --green-500:    #21A366   /* primary action */
    --green-600:    #178552   /* pressed */
    --green-tint:   rgba(33, 163, 102, 0.14)   /* tinted glass fill */
    --ink:          #12241B
    --muted:        #566E62
    --warn:         #E08A2B   /* expiry countdown */
    --danger:       #D14B45   /* superseded, refund */

### The glass recipe
    border-radius: 24px;
    background: var(--glass);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    border: 1px solid var(--glass-stroke);
    box-shadow:
      0 8px 32px rgba(20, 70, 45, .10),
      inset 0 1px 0 rgba(255,255,255,.85);   /* the specular top edge */

The inset top highlight is what separates real glass from a grey box. Do not skip it.

### Glass needs something behind it
Glass over white is just grey. The app ships a fixed green mesh-gradient
background (three radial gradients using --bg-mesh-*), and every glass surface
floats over it. Without that backdrop the entire aesthetic collapses.

### Where glass goes — and where it does not
Apple applies glass to the NAVIGATION layer floating above content, not to the
content itself. Follow that:

  GLASS: top bar, bottom tab bar, floating confirm button, modal sheets,
         the countdown pill, toasts
  SOLID: the slot grid tiles

This is both the correct Apple idiom and the fix for the performance problem
below. Eighteen simultaneously blurred slot tiles will jank; one blurred nav
bar will not.

### Slot state mapping
- Available  -> near-white translucent tile, bright specular edge, ink text
- Contested  -> --green-tint fill, "2 waiting" pill, still light
- Taken      -> OPAQUE solid, desaturated, no blur, no highlight.
                Removing the glass is the signal: it is closed, not floating.
- Past       -> flat, borderless, --muted text

### Risks to manage
- PERFORMANCE. backdrop-filter is expensive on low-end Android. Budget one to
  three blurred layers on screen. Never animate a blurred element's size or
  blur radius; animate transform and opacity only. Test on a real budget phone
  before committing, not on desktop Chrome.
- CONTRAST. Translucent surfaces sit over a background that shifts, so text
  contrast is not fixed. Every text style must clear WCAG AA (4.5:1) against
  the LIGHTEST point of the mesh behind it. Raise --glass alpha rather than
  darken text if a check fails.
- SUNLIGHT. The court is outdoor and the operator works a counter in daylight.
  Frosted low-contrast panels are unreadable in sun. The operator console uses
  --glass-thick, near-opaque surfaces and darker ink. Glass is a customer-app
  aesthetic; the console prioritises legibility over beauty.
- FALLBACK. Where backdrop-filter is unsupported, @supports not
  (backdrop-filter: blur(1px)) swaps in opaque surfaces at 0.92 alpha. The
  layout must never depend on translucency to be legible.
- DARK MODE. Ground to a deep green-black mesh (#0E1A14 -> #16281E) with
  --glass at rgba(255,255,255,0.10) and the specular edge dropped to 0.14
  alpha. Dark glass is much less forgiving; over-bright highlights look plastic.

### Typography and shape
SF Pro on Apple devices, Inter as the fallback stack. Continuous "squircle"
radii where feasible — 24px cards, 18px buttons, 999px pills. Tight tracking on
large headings, generous line height in body copy.

## Build order
1. Schema, spaces, exclusion constraint + a concurrency test firing two
   simultaneous confirmations at one slot, asserting exactly one survives
2. Availability engine + read-only slot grid, both spaces
3. Phone OTP auth, request creation, 30-min expiry, realtime updates
4. Counter console: pending queue, mark-paid, walk-in entry
5. GCash proof submission + operator review queue
6. PWA shell, icons, iOS install sheet, push + SMS (Semaphore)
   + weather forecast on the booking screen (Open-Meteo, no API key needed)
7. Reports, refunds, move-booking, reconciliation

Steps 1-4 are a working business. 5-7 are additive.

All seven are built. What remains is not code: an approved Semaphore sender
name, Vercel environment variables, rotated credentials, and a paid Supabase
tier. See HANDOVER.md section 7.

## Known risks
- 30-minute expiry is aggressive. Defensible for protecting prime slots against
  free requests, but expect friction. Keep it in settings so it can be loosened
  after a few weeks of real use.
- No held slots means the app is advisory until payment. Messaging must be
  explicit or customers will believe they have a reservation.
- Court is outdoor and uncovered: rain refunds will not be rare. Surface a
  weather forecast ships in step 6. It will prevent more refunds than any
  written policy does.
