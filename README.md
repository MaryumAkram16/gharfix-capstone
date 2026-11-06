# GharFix — AI-Powered Local Services Platform

> Originally built for submission to the AI Seekho Antigravity Hackathon.

> **Stack today:** React + Vite (frontend) · Vercel serverless functions in TypeScript (`api/`, `lib/`) · Supabase Postgres via PostgREST · Gemini (intent parsing) · OpenStreetMap Nominatim + Overpass (geocoding, provider search) · Gmail SMTP via Nodemailer · GitHub Actions (schedule) · Vitest

GharFix books home-service providers (plumbers, electricians, AC technicians…) in Pakistan from a chat message in **English, Urdu or Roman Urdu**. It was first built as eight n8n workflows. The n8n host is gone, so the core flow (understand the request → find and rank providers → price → book) has been ported to tested serverless TypeScript. The n8n workflow JSON stays in [`n8n-workflows/`](n8n-workflows/) as the design record.

**Port status**

| Endpoint | Was | Now |
|---|---|---|
| `khadmat-intent` | WF1 (n8n + OpenAI) | `lib/intent/` (Gemini, keyword fallback) |
| `khadmat-provider-match` | WF2 + WF3 (n8n + Google Maps) | `lib/matching/` (OpenStreetMap) |
| `khadmat-booking` | WF4 (n8n + Gmail node) | `lib/booking/` (Supabase, Nodemailer) |
| `khadmat-dispute` | WF6 (n8n + Gmail node) | `lib/dispute/` (Supabase, Nodemailer), §8 |
| `khadmat-quality`, `-reschedule`, `-provider-dashboard` | WF5, WF7, WF8 | **not ported yet**: forwarded to n8n only if `N8N_WEBHOOK_BASE_URL` is set, otherwise they answer 503 |

---

## Contents

1. [Why the port, and what changed](#1-why-the-port-and-what-changed)
2. [Architecture](#2-architecture)
3. [Run it](#3-run-it)
4. [Booking guarantees](#4-booking-guarantees)
5. [Intent parsing](#5-intent-parsing)
6. [Provider matching, pricing and the limits of OpenStreetMap](#6-provider-matching-pricing-and-the-limits-of-openstreetmap)
7. [Demo-data fallback](#7-demo-data-fallback)
8. [After the booking: disputes](#8-after-the-booking-disputes)
9. [Self-healing: retries, incidents, alerts, reconcile](#9-self-healing-retries-incidents-alerts-reconcile)
10. [Tests](#10-tests)
11. [Known limitations](#11-known-limitations)
12. [The original n8n design](#12-the-original-n8n-design)
13. [Privacy and security](#13-privacy-and-security)

---

## 1. Why the port, and what changed

**Why.** The n8n instance the app called (`n8ndigitalstudio.duckdns.org`) stopped when its free hosting ended, so every screen failed. Rather than re-host n8n, the workflows are rewritten as code: one Vercel function per webhook, with the logic in small modules that can be unit-tested with fake dependencies. Paid Google APIs are replaced because no credit card is available.

| n8n building block | Replacement |
|---|---|
| Webhook + Code nodes | `api/*.ts` (web-standard `POST(request)` handlers) calling `lib/**` |
| OpenAI gpt-4o-mini + structured output parser | Gemini REST API with a JSON response schema, then strict validation (`lib/intent/`) |
| Google Geocoding / Places / Distance Matrix | Nominatim / Overpass / straight-line distance, behind `Geocoder` and `ProviderDirectory` interfaces (`lib/matching/directory.ts`) |
| Gmail node | Nodemailer over Gmail SMTP with an app password, behind an `EmailSender` interface (`lib/email/`) |
| n8n schedule trigger | GitHub Actions cron (Vercel Hobby cron runs only daily) |

**Kept identical.** Request and response JSON shapes (the frontend still posts `{ endpoint, ...body }` to `/api/proxy`); WF2's 7-factor scoring and WF3's pricing (checked against the original n8n code, §6); WF4's service durations, travel buffer and overlap rule.

**Changed on purpose**, each covered by tests:
- Slots are normalised to 24h `HH:MM` everywhere ("4:00 PM" and "16:00" are the same slot).
- WF4's simulated "offline" slots and WF2's invented ratings and reviews are gone.
- Double booking is stopped by a database unique index, not only by a pre-check (§4).
- Confirm requests are idempotent (§4).
- Surge pricing uses the Pakistan hour, not the server's UTC clock.
- Booking dates are Pakistan dates (the frontend used the UTC date, so between 00:00 and 04:59 PKT it sent yesterday).
- Errors have HTTP status codes (n8n answered 200 for everything), and the booking screen reads the body before checking the status.

---

## 2. Architecture

```
React frontend (src/)
   │  POST /api/proxy { endpoint, ...body }        (unchanged contract)
   ▼
api/proxy.ts ──► lib/http/proxy.ts  routes by endpoint (allow-list of 7)
   │               ├─ khadmat-intent          → lib/intent/handler.ts
   │               │     Gemini → validate → (fallback) src/lib/intent.ts keyword parser
   │               │     confidence ≥ 70 → provider match in-process, else a clarification question
   │               ├─ khadmat-provider-match  → lib/matching/handler.ts
   │               │     Nominatim → Overpass (→ demo seed, opt-in) → Supabase capacity
   │               │     → provider schema → 7-factor score → price
   │               ├─ khadmat-booking         → lib/booking/handler.ts
   │               │     get_slots | confirm → Supabase (PostgREST) → Gmail SMTP
   │               └─ others                  → n8n if configured, else 503
   │
api/booking.ts, api/intent.ts, api/provider-match.ts   same handlers, called directly
api/reconcile.ts  ◄── .github/workflows/reconcile.yml every 15 min (bearer CRON_SECRET)
   │
lib/resilience/   wraps Supabase, Gemini and SMTP calls: safe-only retries,
                  workflow_incidents rows, de-duplicated alert emails
```

All routes are wired in one place, `lib/app.ts` (`createApp()`), used by both the Vercel functions and the local dev server (`server.ts`). Every handler takes its dependencies (database, email, map services, id generator, clock, logger) as arguments; that is what makes the fake-dependency tests possible.

| Path | What |
|---|---|
| `api/` | Vercel functions (thin: read body, call `lib/`, write response) |
| `lib/booking/` | slots, schedule rules, validation, Supabase repository, receipt/email, handler |
| `lib/intent/` | Gemini client, prompt (copied from n8n), validator, keyword fallback, handler |
| `lib/matching/` | OSM adapters, service→OSM tag table, scoring, pricing, demo directory, handler |
| `lib/resilience/` | retry, policies, incidents, alert email, recorder |
| `lib/reconcile/` | re-send unsent confirmations |
| `lib/http/`, `lib/log.ts` | HTTP results, proxy router, JSON logger (secrets redacted, emails masked) |
| `db/` | original schema files (unchanged) + numbered migrations `001_*`, `002_*` with rollbacks |
| `db/seed/demo_providers.json` | fictional demo providers (§7) |
| `n8n-workflows/` | the original workflows (design record, not executed) |
| `tests/` | Vitest suites (§10) |

---

## 3. Run it

**Prerequisites:** Node.js 20+, npm, a Supabase project.

1. `npm install`
2. Copy `.env.example` to `.env` and fill in what you use. Only names are in the file; secrets come from the environment.
   - **Required for bookings:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-side only).
   - **Optional:**
     - `GEMINI_API_KEY` (without it, the keyword parser is used)
     - `GMAIL_USER` + `GMAIL_APP_PASSWORD` (without them, emails are only logged)
     - `ALERT_EMAIL`, `CRON_SECRET`
     - `USE_DEMO_PROVIDERS` (§7)
     - `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_TIMEOUT_MS` (§6, Google Places as provider source; needs billing)
     - `NOMINATIM_URL`, `OVERPASS_URL`, `OVERPASS_FALLBACK_URL`, `OSM_USER_AGENT`, and the timeouts `NOMINATIM_TIMEOUT_MS`, `OVERPASS_TIMEOUT_MS`, `OVERPASS_BUDGET_MS` (§6)
3. In the Supabase SQL editor, in this order:
   1. `db/bookings.sql` (and `waitlist.sql`, `provider_scores.sql` for the unported workflows), if the tables don't exist yet.
   2. `db/001_booking_integrity_check.sql`: read-only, must return zero rows.
   3. `db/001_booking_integrity.sql`
   4. `db/002_incidents.sql`

   Each migration runs in one transaction and can be rerun; `db/00x_rollback.sql` undoes it.
4. `npm run dev` serves the app and `/api/*` on port 3000 (`server.ts` runs the same `createApp()` as Vercel).

**Deploying on Vercel:**
- Set the same env vars in the Vercel project.
- Apply the migrations **before** deploying code that uses them.
- For the 15-minute reconcile, add the repository secrets `RECONCILE_URL` (e.g. `https://<app>.vercel.app/api/reconcile`) and `CRON_SECRET`. Scheduled workflows only run from the default branch.

Not yet done: a deployment to Vercel has not been made from this branch.

---

## 4. Booking guarantees

`khadmat-booking` has two actions, `get_slots` and `confirm`, with WF4's request and response shapes. What a confirm can return:

| HTTP | `status` | Meaning |
|---|---|---|
| 200 | `confirmed` | booked (or an idempotent replay: `replayed: true`, `booking_status` = current status) |
| 400 | `validation_error` | every missing/invalid field listed in one response |
| 409 | `slot_taken` | taken by the pre-check or by the unique index; includes alternative dates |
| 422 | `idempotency_key_reused` | same key, different request |
| 503 | `service_unavailable` | Supabase did not answer (after safe retries) |

**How double booking is prevented**

1. **Normalised slots.** `normaliseSlot()` (`lib/booking/slot.ts`) and its SQL twin `normalize_slot()` turn every format into `HH:MM`. A test runs about 200 inputs through both and requires identical results, including Unicode digits and spaces. The SQL never raises.
2. **Pre-check** with WF4's rules: service duration + 30 min travel buffer, and both "inside an earlier booking" and "would run into the next one". This gives the friendly 409 in the common case.
3. **Unique index** `bookings_active_slot_key` on `(provider_id, booking_date, normalize_slot(slot))` for confirmed/in-progress rows (`db/001`). This is what makes two simultaneous requests safe: Postgres error 23505 on that index becomes a 409. It is tested with an in-memory fake that enforces the same rule, and against real Postgres 16.

**How retries are made safe**

4. **Idempotency.** The booking screen sends an `idempotency_key` (`crypto.randomUUID()`) and a request fingerprint is stored next to it.
   - Same key and same request: the original receipt is replayed. One row, one email.
   - Same key, different request: 422.
   - Two concurrent requests with the same key: the unique index `bookings_idempotency_key_key` turns the loser into a replay.
5. **Retry after an unclear failure.** If the insert times out after it actually committed, the keyed insert is retried. The retry hits a unique index, a second `booking_id` collision path tries once more with a new id, and the result is a replay of the original booking. The test checks exactly one row and the same booking id.
6. **Try again in the UI** resends the byte-identical request with the same key, so a retry after a timeout replays instead of booking twice. This was checked in a real browser (Playwright): the same key appears on both requests and the booking is saved once.

**How confirmation emails are made reliable**

7. **Email never breaks a booking.** The confirm waits at most 5 s for SMTP. A failure is logged and recorded as an incident; the booking still returns 200.
8. **`confirmation_sent_at`** (`db/002`) is set only when SMTP accepted the message: not for the console fallback, not on failure. `api/reconcile.ts` re-sends the rest (§9).

---

## 5. Intent parsing

`khadmat-intent` keeps WF1's flow:
- parse the request
- if confidence is 70 or more: run the n8n multi-service orchestrator, then provider matching in-process, and answer `{ status: "success", stage: "booking_ready", matching_result }`
- otherwise answer `{ status: "clarification_needed", clarification_question, … }`

- **Gemini.** The prompt is the n8n prompt, unchanged; a test compares it with the workflow file. The output must match a response schema and is then validated strictly: unknown enum values, wrong types or an out-of-range confidence reject the whole answer. The default model is `gemini-3.8-flash` (`GEMINI_MODEL` overrides it). Requests ask for `thinkingLevel: "low"` (`GEMINI_THINKING_LEVEL`: `minimal`, `low`, `medium`, `high`, or `off` to send none), because with the model's default thinking a request on Vercel took longer than the 8 s timeout (`GEMINI_TIMEOUT_MS`). The key is sent in a header, never in the URL.
- **Fallback.** If Gemini isn't configured, is unavailable, rejects the key, blocks the prompt or returns invalid output, the keyword parser `extractIntent()` in `src/lib/intent.ts` is used. That is the same parser the chat UI runs. Responses say which one answered (`intent_source`).
- **Keyword parser fixes.** Fuzzy matching used to turn everyday Roman Urdu words into services and cities: "mein" became *pest control*, "aur" *carpenter*, "kharab" the city *Karak*, and "plumber chahiye Lahore" set the area to "Plumber". Fuzzy matching now needs 5+ letters, matches phrases word by word, and skips a stopword list. Every one of those cases fails on the old parser and passes now.

Not tested live: no Gemini key was available while building this, so the Gemini path is covered by request/response fakes only.

---

## 6. Provider matching, pricing and the limits of OpenStreetMap

**Google Places (optional).** With `GOOGLE_MAPS_API_KEY` set, step 2 asks Google Places API (New) Text Search first, as WF2 did ("Places Nearby Search1"): one request per service, biased to a 5 km circle, results outside it dropped. Providers then carry Google's real rating, review count, price level (→ WF2's base-rate table), open-now (→ four or two booking windows) and business status (→ `verified`), and responses say `data_source: "google_places"`. What n8n invented when Google had nothing (rating 4.0, 10 reviews, "reviewed today", on-time and cancellation rates derived from the rating) stays `null` and is listed in `data_gaps`. If Google fails (bad key, billing off, quota, timeout), an incident is recorded (`google.searchText`) and OpenStreetMap is searched instead; zero Google results are an answer and are not retried on OSM. Geocoding stays on Nominatim.

Cost: the field mask includes rating, price and opening hours, which Google bills as the Text Search *Enterprise* SKU (a small free monthly allowance, then paid per 1,000 requests; check Google's current price list). A billing account is required even for the free allowance. Without the key nothing calls Google. This path is tested with faked HTTP only (`tests/matching/google.test.ts`, `tests/google-flow.test.ts`); no live Google request has been made.

**Pipeline.**
1. Geocode the location (Nominatim, Pakistan only, cached).
2. Search 5 km around it (Overpass), using a service → OSM-tag/name table, e.g. `craft=plumber` or names containing "plumb". If the main Overpass instance times out or fails, a second instance (mirror) is tried before giving up.

   The query is kept cheap for the public servers: nodes and ways only (no relations); name patterns combined into one regex; and that regex applied only to objects tagged as a business (`shop`, `craft`, `office`, `amenity`, `healthcare`), so Overpass narrows by its tag index before reading names. A business with a matching name but none of those tags is not found.
3. Read today's real booking counts from Supabase.
4. Map each place to WF2's provider schema.
5. Score and price.

**Scoring and pricing are WF2/WF3, unchanged.** `tests/matching/golden.test.ts` runs the original n8n Code nodes from the workflow JSON next to the TypeScript and requires identical output. It covers complexity tiers, budgets, multi-service requests, and review-recency, price and surge-hour boundaries. Changing any weight or threshold makes it fail.

| Factor | Weight |
|---|---|
| Distance | 20% |
| Availability | 20% |
| Reviews + recency | 15% |
| Reliability (on-time) | 15% |
| Specialization + job complexity | 15% |
| Price vs budget | 10% |
| Cancellation rate | 5% |

Pricing is the base rate plus a complexity multiplier (1.0 / 1.3 / 1.6), +20% in the Pakistan rush hours (09:00–11:59 and 17:00–19:59), PKR 50/km, and 10% off for multi-service requests.

**What OpenStreetMap cannot provide.** n8n filled these gaps with invented numbers (rating 4.0, 10 reviews, "reviewed today"…). Now they are `null`, every provider lists them in `data_gaps`, and the response says so in `data_notes`.

| Field | From OSM? | What happens instead |
|---|---|---|
| name, location, address tags | yes | used as is |
| rating, review count, last review date | **no** | `null`; the card shows "No ratings or reviews yet (OpenStreetMap listing)" |
| on-time score, cancellation rate, reputation | **no** | `null`; these factors score 0 and are hidden in the breakdown |
| price | **no** | GharFix default PKR 900, marked `base_rate_source: "gharfix_default"` |
| opening hours | partly (free text) | not evaluated; GharFix's default booking windows are offered |
| business status / verified | **no** | `verified: false` |
| road distance | **no** | straight-line distance, labelled "straight line" |
| photos | **no** | none |

Because every OSM provider lacks the same three factors, they don't change the ranking between OSM providers; they lower everyone's absolute score equally.

**Endpoints and timeouts** (env vars; invalid values fall back to the default with a warning):

| Variable | Default |
|---|---|
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org` |
| `NOMINATIM_TIMEOUT_MS` | 5000 |
| `OVERPASS_URL` | `https://overpass-api.de/api/interpreter` |
| `OVERPASS_FALLBACK_URL` | `https://overpass.kumi.systems/api/interpreter` (`off` disables) |
| `OVERPASS_TIMEOUT_MS` | 15000, per instance |
| `OVERPASS_BUDGET_MS` | 20000, across both instances; the mirror is skipped if less than 2 s is left |

None of these env vars is required. The functions that run provider matching (`api/proxy.ts`, `api/intent.ts`, `api/provider-match.ts`) set `export const config = { maxDuration: 60 }` (Vercel's in-file config for Node.js `/api` routes), so a search bounded by about 25 s (5 s + 20 s) fits with room for Supabase and Gemini.

Every final failure of the geocoder or the directory is recorded as an incident (§9). The answer is then a 503, unless the demo fallback is on (§7).

Not tested live: this environment's network policy blocks `nominatim.openstreetmap.org`, `overpass-api.de` and the mirror, so the adapters and the mirror logic are tested against fakes built from the documented response formats. The public services have usage limits (Nominatim: at most 1 request/second with an identifying User-Agent); for real traffic, point these URLs at your own or a commercial instance.

---

## 7. Demo-data fallback

Off by default. With `USE_DEMO_PROVIDERS=1` (exactly `1`), matching falls back to `db/seed/demo_providers.json` (28 fictional providers around 13 areas of Lahore and Islamabad; as a fallback it searches each city within 25 km, and shows the real straight-line distance) when OpenStreetMap returns **zero** providers, or when it **fails**: both Overpass instances timed out or errored.

- **Clearly labelled data:**
  - The file starts with a "DEMO DATA" notice.
  - Every id starts `demo:`, every name `[DEMO] `, every address "Demo listing, …".
  - A validator rejects the file if it contains ratings, reviews or prices, so even demo data invents nothing beyond the listing.
- **Clearly labelled responses:**
  - `data_source` is `"demo_seed"` (instead of `"openstreetmap"`), and every provider has `source: "demo_seed"`.
  - The UI shows a "DEMO DATA" banner and a "Demo data" badge on each card (checked in a browser).
- **Why it is shown:** `data_notes.demo_reason` is `osm_empty` or `osm_unavailable`, and the banner says which ("no OpenStreetMap listings were found nearby" vs "OpenStreetMap could not be reached right now").
- **An outage is still recorded:** the incident (and de-duplicated alert) is written before the demo covers for it.
- **With the flag off,** an OpenStreetMap failure is a 503, as before. With the flag on but no demo providers for the area (outside Lahore and Islamabad), it is also a 503, never a false "no providers found".
- **Bookings are real:** booking a demo provider writes a real booking row (identifiable by its `demo:` provider id and `[DEMO]` name).

---

## 8. After the booking: disputes

`khadmat-dispute` (WF6) is ported in `lib/dispute/`. The five rule sets (no-show, provider cancelled, quality complaint, price disagreement, overrun) keep n8n's thresholds and amounts; `tests/dispute/decide.test.ts` runs the original n8n Code nodes on the same inputs and compares the results.

**What changed, and why:**
- **Facts come from the booking row, not the request.** n8n refunded the `price_pkr` the browser sent and emailed the `user_email` the browser sent. The port reads price, final price, provider, date, slot and email from Supabase by `booking_id`. The request only carries the customer's claim (rating, review, extra charge, durations).
- **The caller's email must match the booking's** (case-insensitive), otherwise 403. This is a check, not authentication: the app has no login yet.
- **No invented inputs:**
  - The provider's cancellation rate is computed from their bookings (`no_show` + `provider_cancelled` out of all), instead of n8n's assumed 12%.
  - A complaint with no rating goes to a person (`escalated_to_human`, severity `UNRATED`). n8n assumed 1/5, so any written complaint became a CRITICAL 50% refund.
  - A price dispute with no recorded final price and no customer figure goes to a person. n8n assumed PKR 0 charged and always answered "no overcharge".
  - A refund that rests only on the customer's stated charge is calculated but marked `escalated_to_human`: a person confirms the amount first.
  - An overrun dispute must send both durations (n8n assumed 60 and 90 minutes).
- **Urgency uses the booked slot in Pakistan time.** n8n used midnight UTC of the date.
- **Invalid requests stop with a 400.** In n8n an unknown `dispute_type` or missing `booking_id` still ran the overrun branch and PATCHed `booking_id=eq.undefined`.
- **The status change is a compare-and-set** on the status that was read, so two submissions cannot both apply (the second gets 409 and can retry). Repeating the same dispute answers again with `already_recorded: true`, without a second update or email.
- **Texts no longer promise what nothing does** (n8n: "BLACKLISTED — will not appear in future WF2 results"; matching has no blacklist, so the port says "suspension recommended" and leaves it to a person).
- **Self-healing:** Supabase reads are retried, the update is not; every final failure is an incident with an alert. The dispute email goes out after the status is saved; if it fails, the response says `email: "failed"` and the dispute stands.

Refunds, compensation and penalties are decisions recorded in the response and on the booking (`status`, `previous_status`, `flagged_for_review`); no money moves.

---

## 9. Self-healing: retries, incidents, alerts, reconcile

**Retries only where a repeat cannot act twice** (`lib/resilience/policies.ts`):

| Call | Retried? |
|---|---|
| Supabase reads (slots, idempotency lookup, capacity, reconcile scan) | yes: 3 tries, 250 ms then 750 ms, on outages (5xx, 429, network, timeout) |
| Booking insert **with** an idempotency key | yes, same policy (a repeat becomes a replay, §4) |
| Booking insert **without** a key | **never** (could double-book) |
| Gemini | yes: 2 tries on 429/5xx/network, not after a timeout |
| SMTP sends, `confirmation_sent_at` update, alert emails | **never** (could email twice); the reconciler handles unsent confirmations |

**Incidents.** Each final failure, and each failure a retry fixed (`auto_fixed = true`), becomes a row in `workflow_incidents` (`db/002`). Columns:
- `workflow`, `step`, `error_class`
- `retryable`, `auto_fixed`
- `request_id`, `payload_hash`, `created_at`

There is no free-text column, so no secret or customer data can be stored. Row-level security is on with no policies, so the public anon key cannot read or write it; a test checks this against real Postgres.

**Alerts.** A final failure sends one plain-language email to `ALERT_EMAIL`: what broke, what was tried, and what to do (e.g. "Supabase rejected the key. Check SUPABASE_SERVICE_ROLE_KEY…", or "Gmail rejected the login. Check GMAIL_APP_PASSWORD…"). Emails are masked. Repeats of the same failure (same `payload_hash`) within `ALERT_DEDUPE_MINUTES` (default 60) send nothing. De-duplication works even while Supabase is down (in memory). Recording and alerting never throw and are time-boxed: a broken alert email never breaks a booking.

**Reconcile.** `api/reconcile.ts`, called every 15 minutes by `.github/workflows/reconcile.yml` with `Authorization: Bearer <CRON_SECRET>`:
- **Which bookings:** confirmed, `confirmation_sent_at` NULL, created between 5 minutes and 24 hours ago, with a real address (test domains such as `@example.test` are never mailed).
- **What it does:** re-sends each confirmation and records it.
- **What it returns:** `{ found, fixed, failed, skipped, deferred }`.
- **Idempotent:** a second run finds nothing.
- **Never overlapping:** the workflow uses a concurrency group so two runs never send at once.

---

## 10. Tests

```bash
npm test
```

```bash
npx tsc --noEmit
```

Every external dependency is faked in the unit tests: Supabase, Gemini, Nominatim, Overpass, SMTP, the clock and ids. Test data uses `@example.test` addresses and `BK-TEST-` booking ids only. Main suites:

| Area | Files |
|---|---|
| Slots, schedule, validation, receipt, repository, booking handler | `tests/booking/` |
| Scoring/pricing vs the original n8n code, OSM adapters, matching handler, demo data | `tests/matching/` |
| Gemini client, validator, prompt-equals-n8n, keyword fallback, intent handler | `tests/intent/` |
| Retries, policies, incidents, alerts, de-duplication, booking with resilience | `tests/resilience/` |
| Dispute rules vs the original n8n code, dispute handler (ownership, compare-and-set, email) | `tests/dispute/` |
| Reconciler, its auth, and the workflow file | `tests/reconcile/` |
| Frontend helpers: booking response handling, keyword parser, transformer, Pakistan date | `tests/frontend/` |
| Whole flows through `createApp()` with only HTTP faked | `tests/app.test.ts`, `tests/intent-flow.test.ts`, `tests/demo-flow.test.ts`, `tests/google-flow.test.ts`, `tests/dispute-flow.test.ts` |
| `api/` loaded in plain Node ESM (no bundler), as Vercel runs it | `tests/api/esm.test.ts` |

**Migrations against real Postgres.** These are skipped unless `TEST_DATABASE_URL` points at a **local** server; the helper refuses anything else. They create and drop their own throwaway database:

```bash
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres npx vitest run tests/db
```

**Checked by hand (not in CI):** the booking and match screens in Chromium with Playwright (Try again, 409 screen, no-ratings and demo labels, booking date at 00:30 PKT), and the reconcile workflow's shell step against a local stub (200 passes; 401 and missing secrets fail).

**Verified live** (production Vercel logs, 2026-11-06): a chat message parsed by Gemini, providers found with Google Places around a Nominatim-geocoded location, a booking saved in Supabase, and its confirmation sent through Gmail SMTP.

**Not verified yet:** Overpass from Vercel (it timed out in every logged request, so the demo fallback or Google covered it); disputes against the real database (tested with fakes only); a scheduled GitHub Actions run.

---

## 11. Known limitations

- **Overlap gap.** The unique index only catches two bookings with the *same* start time. Two simultaneous requests for overlapping windows (16:00 and 16:30 for a 150-minute job) can both pass the pre-check. A Postgres exclusion constraint is planned as `db/003`; the repository already maps its error (23P01) to `slot_taken`.
- **5-second email wait.** A confirm waits up to 5 s for SMTP. A slower send is recorded as failed and left to the reconciler, so if it was eventually delivered the customer can get the confirmation twice. The same can happen if SMTP succeeds but recording `confirmation_sent_at` fails.
- **Gmail limits.** Gmail's own sending limits apply (about 500 messages a day for a personal account), and Gmail sends as the authenticated account.
- **Google Places.** Needs a billing-enabled key; it has no on-time or cancellation history and review dates are not requested, so those stay null.
- **OpenStreetMap data.** No ratings, reviews, prices or road distance (§6). Coverage of small Pakistani businesses varies widely by area, and the public endpoints are rate-limited.
- **Keyword parser.** It is dictionary-based. Spellings it doesn't know are missed, and the fuzzy matcher is deliberately strict to avoid false services.
- **No login.** Disputes check that the caller's email matches the booking's, but an email address is not a secret: anyone who knows both the booking id and the email can file a dispute.
- **Unported workflows.** Quality loop, rescheduling and the provider dashboard still need n8n (503 without it). Their screens still check `response.ok` before reading the body.
- **Scheduling.** GitHub may delay or skip scheduled runs, and the reconcile workflow only runs once it is on the default branch.
- **Time limits.** The provider-matching functions have `maxDuration: 60`. A provider search is bounded by Nominatim (5 s) + Overpass (20 s across both instances) by default, plus Google Places (8 s) first when its key is set. If *every* dependency times out at once on the intent path (Gemini 8 s × 2, Nominatim 5 s, Google 8 s, Overpass 20 s, Supabase capacity 8 s × 3 tries) the total can pass 60 s and Vercel stops the function; lower the timeouts if that matters. Other functions (`api/booking.ts`, `api/reconcile.ts`) use the plan's default duration.

---

## 12. The original n8n design

The JSON in `n8n-workflows/` is kept unchanged as the design record. WF1–WF4 and WF6 are ported; the rest are not yet:

| Workflow | Purpose |
|---|---|
| WF1–WF3 | intent extraction (gpt-4o-mini), Google Places matching, 7-factor scoring, pricing |
| WF4 | slots with travel buffer; confirm with a race-condition pre-check |
| WF5 | service quality loop: en route → arrived → completed → feedback, with sentiment and rating |
| WF6 | dispute rules (no-show, provider cancelled, quality, price, overrun) with tiered refunds |
| WF7 | cancellation and auto-reschedule with penalties, compensation and waitlist |
| WF8 / WF8b | provider dashboard, and a nightly `provider_scores` refresh |

The demo video ([assets/demo-video.mp4](assets/demo-video.mp4)) shows the original n8n version, which used Google Places providers. The earlier README's latency/cost tables and sample reasoning traces described that deployment and are in git history; they were not re-measured for the port.

---

## 13. Privacy and security

- **Secrets:** they come only from environment variables (`.env.example` lists names only). The Supabase service-role key is used server-side, in request headers only.
- **Logs:** one JSON line per event, with secret-looking keys redacted and email addresses masked. The intent text is not logged.
- **Outbound requests:** request bodies are built with `JSON.stringify`, and query strings with `URLSearchParams` (PostgREST `in.()` values are quoted). User text never reaches the Overpass query; only table entries and the service's own letters do.
- **Model output** is treated as untrusted input and validated.
- **Confirmation emails** HTML-escape all user-supplied text.
- **`workflow_incidents`** holds no free text, and RLS keeps the anon key out.
- **Payments:** none are taken (cash on service).

---

*GharFix — Ghar ka kaam, AI ke saath.*
