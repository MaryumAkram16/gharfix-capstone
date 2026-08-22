# GharFix — AI-Powered Local Services Platform

> Originally built for submission to the AI Seekho Antigravity Hackathon.

> **Stack:** React + Capacitor (Frontend) · n8n (AI Agent Workflows) · Supabase · Google Maps/Places API · OpenAI GPT-4o-mini · Gmail API

---

## Table of Contents

1. [Overview](#1-overview)
2. [Problem Statement](#2-problem-statement)
3. [Solution Architecture](#3-solution-architecture)
4. [Run Locally](#4-run-locally)
5. [System Orchestration — Frontend Routing to n8n Agent Workflows](#5-system-orchestration--frontend-routing-to-n8n-agent-workflows)
6. [Workflow Reasoning Traces](#6-workflow-reasoning-traces)
7. [AI Agent Workflows (n8n)](#7-ai-agent-workflows-n8n)
8. [Provider Score Refresh (Nightly) — WF8b](#8-provider-score-refresh-nightly--wf8b)
9. [Provider Dataset Schema](#9-provider-dataset-schema)
10. [Provider Matching Factors](#10-provider-matching-factors)
11. [APIs & Tools Used](#11-apis--tools-used)
12. [Cost & Latency Analysis](#12-cost--latency-analysis)
13. [Assumptions](#13-assumptions)
14. [Baseline Comparison](#14-baseline-comparison)
15. [Privacy & Security Note](#15-privacy--security-note)
16. [Limitations](#16-limitations)
17. [Future Improvements](#17-future-improvements)
18. [Capstone Concept Mapping](#18-capstone-concept-mapping)

---

## 1. Overview

GharFix is an AI-powered home services platform designed for the informal economy in Pakistan. It enables users to effortlessly book trusted local service providers through natural language conversations in **English, Urdu, and Roman Urdu**. The platform addresses critical challenges in service discovery — unreliable matching, unpredictable pricing, and weak post-booking support — by leveraging a set of specialized AI-driven workflows, each handling one stage of the service lifecycle.

**Core Capabilities:**

- **Conversational AI:** Understanding and responding to multilingual user requests (47 service types, 71 cities, 82 named areas).
- **Intelligent Provider Matching:** 7-factor weighted ranking of real Google Maps providers.
- **Automated Workflow Execution:** Managing the end-to-end service lifecycle with minimal manual intervention.
- **Booking Lifecycle Management:** From scheduling and confirmation through feedback and dispute resolution.
- **Provider Optimization:** Continuous evaluation and improvement of provider performance dashboards.
- **Waitlist Management:** Automatic waitlist enrollment when no slot or alternative provider is available.

---

## 2. Problem Statement

The informal service economy in Pakistan suffers from inefficient service discovery — time-consuming manual searches via WhatsApp and phone calls, unreliable providers, unpredictable pricing, and no structured post-service support. Existing platforms offer static listings, lack intelligent matching, and provide inadequate support for local languages. GharFix solves these problems with AI-driven workflows that automate matching, booking, and post-service support to improve trust, automation, and service quality.

---

## 3. Solution Architecture

### High-Level Architecture

```
Frontend (React + Capacitor — Mobile + Web)
          ↓  routes each user action to a specific n8n webhook via a single proxy (/api/proxy)
n8n Workflow Engine (Specialized AI Agents)
  ├── WF1/WF2/WF3  Intent, Provider Matching & Pricing Agent
  ├── WF4          Booking Agent
  ├── WF5          Service Quality Loop
  ├── WF6          Dispute & Escalation Handler
  ├── WF7          Cancellation & Auto-Reschedule
  ├── WF8          Provider Optimization Agent
  └── WF8b         Provider Score Refresh (Nightly, scheduled)
          ↓
External Services
  ├── Google Maps API  (Geocoding, Places, Distance Matrix)
  ├── Supabase         (PostgreSQL — bookings, waitlist, provider_scores tables)
  ├── OpenAI GPT-4o-mini  (Intent extraction LLM)
  └── Gmail API        (Transactional email notifications)
```

---

## 4. Run Locally

**Prerequisites:** Node.js and npm.

1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env.local` and set:
   - `N8N_WEBHOOK_BASE_URL` — your n8n instance's webhook base URL (defaults to the maintainer's instance if unset)
3. In Supabase, run the SQL files in `/db/` in this order: `bookings.sql`, `waitlist.sql`, `provider_scores.sql`.
4. In n8n, import the workflows from `/n8n-workflows/` and attach your own Supabase (header auth), OpenAI, Google Maps, and Gmail credentials to the relevant nodes.
5. Run the app:
   `npm run dev`

The server runs on port 3000 by default. If that port is already in use, free it or stop the conflicting process before running `npm run dev`.

---

## 5. System Orchestration — Frontend Routing to n8n Agent Workflows

There is no separate orchestration layer deciding what happens next at runtime. Each screen in the React frontend calls a specific n8n workflow directly, through one shared proxy route (`server.ts` → `/api/proxy` → `https://{your-n8n-instance}/webhook/{endpoint}`). The frontend's job is to know which workflow to call at which step and what to do with the response; each n8n workflow's job is to do the actual work — extracting intent, scoring providers, checking availability, writing to Supabase, sending email.

### Which screen calls which workflow

| Frontend view | Endpoint called | Workflow |
|---|---|---|
| `ChatView`, `HomeView` | `khadmat-intent` | WF1–WF3 (Intent, Matching & Pricing) |
| `BookingView` | `khadmat-booking` | WF4 (Booking Agent) |
| `ServiceQualityView` | `khadmat-quality` | WF5 (Service Quality Loop) |
| `BookingsListView` (dispute) | `khadmat-dispute` | WF6 (Dispute & Escalation) |
| `BookingsListView`, `ProviderCancelSheet` | `khadmat-reschedule` | WF7 (Cancellation & Auto-Reschedule) |
| `ProviderDashView` | `khadmat-provider-dashboard` | WF8 (Provider Optimization) |

WF8b runs independently of the frontend entirely — it's triggered by an n8n schedule, not a user action.

### Request pipeline for a booking

```
User Query (any language)
    ↓
Frontend → calls extract_intent (WF1)
    ↓  [isComplete: true]
Frontend → calls find_providers (WF2 + WF3)
    │   Geocode location → Places search → Distance Matrix
    │   → Capacity check (Supabase) → 7-factor score → Price calculation
    ↓
Frontend presents top match, stores alternatives[]
    ↓  [user confirms provider + slot]
Frontend → calls confirm_booking (WF4)
    │   Race-condition check → Insert to Supabase → Send email
    ↓
Frontend → calls track_service stages: en_route → arrived → completed → feedback (WF5)
    │   [if rating ≤ 2 → auto-escalates to WF6]
    ↓
Frontend → calls handle_dispute if needed (WF6)
    ↓
Frontend → calls cancel_or_reschedule if needed (WF7)
    │   Penalty engine → Alternative picker → Slot selector → Re-confirm via WF4
    │   [if no slot → waitlist] [if no alternative → waitlist + full refund]
    ↓
Frontend → calls get_provider_dashboard for provider-side view (WF8)
```

Recovery logic (retry, offer alternate dates, escalate, or enroll in waitlist) is handled inside each workflow itself — e.g. WF4 returns a `slot_taken` response with alternative dates already computed, rather than leaving that decision to the frontend.

---

## 6. Workflow Reasoning Traces

Every n8n workflow returns a structured reasoning trace in its JSON response (internally keyed `antigravity_trace` — a legacy field name from the project's original build tooling, kept as-is in the code). It documents why a decision was made and what data it was based on, which is useful both for debugging and for showing the reasoning behind an automated decision (e.g. a refund amount, a provider ranking). Below are three real sample traces from production runs.

### Trace 1 — Provider Selection (WF2 Calculate Provider Scores)

```json
{
  "antigravity_trace": {
    "workflow": "WF2-ProviderMatching",
    "reasoning": [
      "STEP 1 — User requested 'Plumber' in 'Johar Town, Lahore' with high urgency and high budget_sensitivity.",
      "STEP 2 — Geocoded location: lat 31.4697, lng 74.2728. Searched Google Places: 8 providers returned.",
      "STEP 3 — Fetched today's active bookings from Supabase. Provider ChIJzUJz89oB has 2/4 slots filled (MODERATE). Provider ChIJ8YeHj has 4/4 slots filled (FULL — excluded from availability score).",
      "STEP 4 — Scored all 8 providers across 7 factors. Top result: ChIJzUJz89oB scored 84. Breakdown: distance=80, availability=100, review=92, reliability=90, specialization=100, price=60, cancellation=95.",
      "STEP 5 — Job complexity = intermediate. Provider's complexity_levels = ['basic','intermediate'] → complexity_match: true → specialization score boosted to 100.",
      "STEP 6 — Budget sensitivity = HIGH. Provider base_rate_pkr = 900 → price score = 70 (within acceptable range for high-sensitivity user).",
      "STEP 7 — Price calculated: base 900 + complexity 270 + surge 0 (outside peak hours) + distance 105 = PKR 1275 total.",
      "STEP 8 — Recommended Provider: 'Al Madina electric store' (score 84). Next best: 'Bismillah electrician' (score 84). Alternatives array passed to the frontend for potential reschedule use."
    ],
    "confidence": 91,
    "data_sources": {
      "providers": "Google Places Text Search API",
      "capacity": "Supabase bookings table — today confirmed/in_progress",
      "distance": "Google Distance Matrix API"
    }
  }
}
```

### Trace 2 — Dispute Escalation (WF6 Quality Complaint Handler)

```json
{
  "antigravity_trace": {
    "workflow": "WF6-QualityComplaint",
    "reasoning": "Quality complaint for booking BK-2026-1778878469314-066. Rating: 2/5. Sentiment: negative (keywords found: ['late','kharab']). Auto-escalated from WF5 feedback stage. Severity classified as HIGH (rating=2, negative sentiment). Compensation decision: 25% of PKR 1150 = PKR 288 refund approved. Provider 'YS Painters' score delta: -15. Flagged for 7-day monitoring. Human escalation: NOT required (threshold is rating=1 or CRITICAL). Booking status updated to 'disputed' in Supabase.",
    "confidence": 88,
    "decision_factors": ["rating_score", "sentiment_analysis", "review_keywords", "auto_escalation_flag"]
  }
}
```

### Trace 3 — Provider Optimization Dashboard (WF8 Optimization Engine)

```json
{
  "antigravity_trace": {
    "workflow": "WF8-ProviderOptimization",
    "reasoning": [
      "STEP 1 — Fetched 23 total bookings for provider 'YS Painters' (ID: ys_painters).",
      "STEP 2 — Workload today: 2/4 slots (50% utilization). Status: MODERATE.",
      "STEP 3 — Earnings calculated using final_price_pkr (actual paid, set by WF5 completed stage): PKR 21400 across 18 completed jobs. Avg: PKR 1189 vs platform avg PKR 1200. Fairness: FAIR.",
      "STEP 4 — Reputation from WF5 ratings: 18 ratings, avg 4.3/5. Flagged by WF6: 1. Health: GOOD.",
      "STEP 5 — Cancellation analysis from WF7 data: 2 cancellations out of 23 total. Rate: 9%. Status: GOOD.",
      "STEP 6 — Loyalty: 3 repeat customer(s) detected from completed bookings.",
      "STEP 7 — Demand forecast: Top slot is 10:00 with 5 platform bookings.",
      "STEP 8 — Rate suggestion: Fair relative to platform avg. No change needed.",
      "STEP 9 — Generated 4 optimization tips for provider."
    ],
    "data_sources": {
      "ratings": "customer_rating field written by WF5 feedback stage",
      "flags": "flagged_for_review field written by WF6 dispute handler",
      "cancellations": "cancellation_reason field written by WF7 auto-reschedule",
      "earnings": "final_price_pkr written by WF5 completed stage"
    },
    "confidence": 93
  }
}
```

---

## 7. AI Agent Workflows (n8n)

Each n8n workflow is a specialized AI agent, called directly by the frontend for one step in the service lifecycle (see the routing table in section 5).

### WF1/WF2/WF3 — Intent, Provider Matching & Pricing Agent

The frontend calls this workflow with the raw user query. WF1 passes it through GPT-4o-mini with a structured output parser to extract service type, location, urgency, budget sensitivity, job complexity, and language. WF2 geocodes the location, searches Google Places, checks real-time capacity from Supabase, and scores all providers. WF3 calculates the dynamic price breakdown.

**Features:**
- Multilingual support (English, Urdu, Roman Urdu) with fuzzy spell correction.
- NLP-based service classification covering 47 service types across 71 cities.
- Confidence scoring — below 70% triggers a clarification question in the user's own language.
- 7-factor provider scoring algorithm with job complexity matching.
- Fallback geocoding for unknown area names using a hardcoded coordinate map.
- Multi-service support with 10% bundle discount.

### WF4 — Booking Agent

The frontend calls this workflow to manage slot availability and confirm bookings. It has two steps: Step A checks existing bookings with travel-time buffer logic to build an accurate available slot list; Step B performs a race-condition check at the exact moment of confirmation to prevent double-booking.

**Features:**
- Service-duration map (AC install = 180 min, painter = 240 min, etc.) plus 30-min travel buffer.
- Exact slot conflict detection plus buffer window overlap detection.
- Atomic race-condition check before writing to Supabase.
- Unique booking ID generation (`BK-{year}-{timestamp}-{random}`).
- Confirmation email via Gmail API.
- Slot-taken fallback with alternative dates offered automatically.

### WF5 — Service Quality Loop

The frontend calls this workflow through four sequential stages to manage the complete post-booking service lifecycle.

**Stages:**
- `en_route` — calculates ETA from distance, updates status in Supabase, sends email.
- `arrived` — logs arrival time, generates service-specific checklist (7–9 steps), updates status to `in_progress`.
- `completed` — records final price (`final_price_pkr`), detects price overruns, sends completion email.
- `feedback` — records 1–5 star rating, written review, optional voice transcript, up to 3 base64 photo attachments. Runs sentiment analysis. Updates provider reputation. Auto-escalates to WF6 if rating ≤ 2.

### WF6 — Dispute & Escalation Handler

When issues arise, the frontend calls this workflow to handle dispute resolution. It routes by `dispute_type` and applies tiered resolution logic.

| Dispute Type | Decision Logic |
|---|---|
| `no_show` | Full refund. Cancellation rate >20% → blacklist. Otherwise → warning strike. |
| `provider_cancelled` | Penalty strike. Auto-rebook from alternatives list. PKR 200 credit if <3 hours to appointment. |
| `quality_complaint` | Rating 1 or negative sentiment → 50% refund + human escalation. Rating 2 → 25% refund. Rating 3 → warning only. |
| `price_disagreement` | ≤10% variance → warning only. 11–30% → 75% of excess refunded. >30% → full excess refunded. |
| `overrun` | Pre-approved → charge stands. Not notified → extra rejected. <15 min overrun → ≤10% extra. >15 min → 50% of extra approved. |

All outcomes update `status` and `flagged_for_review` in Supabase and send a dispute update email to the user.

### WF7 — Cancellation & Auto-Reschedule

The frontend calls this workflow to handle three cancellation modes: user cancel only, user reschedule, and provider cancel. For reschedules, it runs a full pipeline: penalty engine → alternative picker (sorted by `computed_score`) → calls WF4 Step A to get slots for new provider → calls WF4 Step B to confirm → updates original booking in Supabase → sends email.

**Waitlist Management:** When no alternative provider exists, or the alternative has no available slots, the user is automatically enrolled in the Supabase `waitlist` table. A ticket is created and the user is notified by email. The system offers three alternate date suggestions.

**Compensation Logic:**
- <3 hours to appointment → PKR 250 credit
- <12 hours to appointment → PKR 100 credit

### WF8 — Provider Optimization Agent

This workflow gives providers a complete performance dashboard, called live when a provider opens their dashboard.

**Sections computed:**
- **Workload** — today's utilization vs max capacity, open slots, status label.
- **Earnings** — total from `final_price_pkr` (actual paid), avg per job vs platform average, fairness label.
- **Reputation** — avg rating from `customer_rating` (written by WF5), flagged count from WF6, health label.
- **Cancellations** — rate from WF7 records, status label.
- **Loyalty** — repeat customer detection by email, suggested 5% discount.
- **Demand Forecast** — top 3 slots by platform-wide booking volume.
- **Rate Optimization** — suggested base rate if earnings below platform average.

---

## 8. Provider Score Refresh (Nightly) — WF8b

WF8b runs on a nightly n8n schedule trigger instead of a live webhook. It fetches all bookings once, computes optimization scores for every provider in a single batch pass (same logic as WF8), and upserts the results into a `provider_scores` Supabase table (schema in `/db/provider_scores.sql`). The provider dashboard can then read a precomputed score instead of recalculating it on every request — this table doubles as the platform's caching layer.

---

## 9. Provider Dataset Schema

Each provider entry is built live from Google Places data, enriched with computed fields. The full runtime schema used by WF2 is:

```json
{
  "id": "ChIJzUJz89oBGTkRji1Qo6_dj8I",
  "name": "Al Madina Electric Store",
  "owner": "Al Madina Electric Store",
  "services": ["electrician", "fan repair"],
  "complexity_levels": ["basic", "intermediate"],
  "areas": ["Johar Town, Lahore"],
  "coordinates": { "lat": 31.4607, "lng": 74.2760 },
  "address": "Johar Town, Lahore",
  "base_rate_pkr": 900,
  "rating": 5.0,
  "review_count": 48,
  "last_review_date": "2026-05-18",
  "on_time_score": 0.95,
  "cancellation_rate": 0.04,
  "availability_slots": ["09:00", "11:00", "14:00", "16:00"],
  "active_bookings": 2,
  "max_daily_bookings": 4,
  "at_capacity": false,
  "distance_km": 2.3,
  "verified": true,
  "reputation_score": 87,
  "google_maps_url": "https://maps.google.com/?q=Al+Madina+Electric",
  "place_id": "ChIJzUJz89oBGTkRji1Qo6_dj8I",
  "photos": ["https://maps.googleapis.com/maps/api/place/photo?..."],
  "source": "google_maps"
}
```

**Supabase `bookings` table key fields (written by multiple workflows):**

| Field | Written By | Purpose |
|---|---|---|
| `status` | WF4, WF5, WF6, WF7 | Booking lifecycle state |
| `slot` | WF4 | Confirmed time slot |
| `final_price_pkr` | WF5 completed stage | Actual amount paid (used by WF8 earnings) |
| `customer_rating` | WF5 feedback stage | Star rating (used by WF8 reputation) |
| `flagged_for_review` | WF6 | Dispute flag (used by WF8 reputation) |
| `cancellation_reason` | WF7 | Provider cancellation log (used by WF8 cancellation) |
| `rescheduled_to_booking_id` | WF7 | Link to replacement booking |

---

## 10. Provider Matching Factors

WF2's scoring engine evaluates all nearby providers across **7 weighted factors**:

| # | Factor | Weight | How It's Calculated |
|---|---|---|---|
| 1 | **Distance / Travel Time** | 20% | `max(0, 100 - distance_km × 10)` via Google Distance Matrix API |
| 2 | **Availability** | 20% | Has open slots AND `active_bookings < max_daily_bookings` → 100; slots only → 50; none → 0 |
| 3 | **Review Score + Recency Bonus** | 15% | `(rating/5) × 100` + up to 15 pts bonus if reviewed within 3 days |
| 4 | **Reliability / On-Time Score** | 15% | `on_time_score × 100` (derived from rating with provider-behaviour adjustment) |
| 5 | **Skill Specialization + Job Complexity Match** | 15% | Service match + complexity tier match → 100; one tier short → 55; no match → 20 |
| 6 | **Price vs Budget Sensitivity** | 10% | Tiered by `budget_sensitivity`: high-sensitivity users get higher scores for cheaper providers |
| 7 | **Cancellation Rate** | 5% | `max(0, 100 - cancellation_rate × 500)` |

### Job Complexity Classification

Job complexity is explicitly classified as `basic`, `intermediate`, or `complex` and matched against the provider's `complexity_levels` array:

- **basic** — simple check or inspection (AC gas refill, geyser check)
- **intermediate** — repair or component replacement (AC repair, electrician fault fix)
- **complex** — full installation or overhaul (AC installation, solar installation, false ceiling)

A provider offering only basic services scores 25 on specialization for a complex job (two tiers short). This prevents mismatched assignments even when the provider is nearby and highly rated.

---

## 11. APIs & Tools Used

| Tool / API | Role |
|---|---|
| **n8n** | AI agent workflow automation — one specialized workflow per service-lifecycle step |
| **Google Maps Geocoding API** | Converts area names to lat/lng coordinates |
| **Google Places Text Search API** | Discovers real nearby service providers |
| **Google Distance Matrix API** | Calculates driving distance and travel time between user and providers |
| **OpenAI GPT-4o-mini** | Natural language intent extraction with structured output parsing |
| **Supabase (PostgreSQL)** | Database for bookings, waitlist, provider_scores, real-time capacity checks |
| **Gmail API** | Transactional emails (confirmation, en-route, arrived, completed, dispute, cancellation) |
| **React + Capacitor** | Cross-platform frontend — web + mobile from a single codebase |

---

## 12. Cost & Latency Analysis

### Per-Request Latency Breakdown

| Component | Average Latency | Notes |
|---|---|---|
| Intent Extraction (GPT-4o-mini) | 1–3 sec | Includes structured output parsing |
| Google Maps Geocoding | ~300 ms | Cached for repeated locations |
| Google Places Search | 500 ms – 1 sec | Returns up to 20 results |
| Google Distance Matrix | ~400 ms | Called once per Places batch |
| Supabase Capacity Query | <100 ms | Indexed on `provider_id + booking_date` |
| n8n Workflow Execution (WF4 confirm) | 400–800 ms | Includes race-condition check + DB write |
| Gmail Email Send | 300–600 ms | Async — does not block webhook response |
| **Total End-to-End (booking confirm)** | **~4–7 sec** | Full path: intent → match → price → confirm |

### Estimated Cost per Booking (at scale)

| Component | Estimated Cost |
|---|---|
| GPT-4o-mini (intent + structured output) | ~$0.001 per request |
| Google Maps (Geocode + Places + Distance) | ~$0.010–$0.017 per booking |
| Supabase (free tier up to 500 MB) | ~$0 for prototype scale |
| n8n (self-hosted) | Infrastructure cost only |
| Gmail API | Free up to 500 emails/day |
| **Total per booking** | **~$0.012–$0.020** |

### Optimization Strategies

- Unnecessary LLM calls are eliminated — `extract_intent` is cached within a conversation turn.
- Google Places results are reused across the matching and scoring steps without a second API call.
- Supabase capacity queries use a single indexed query for all providers in the day's batch.
- n8n workflows respond to the webhook before triggering email sends (parallel branches).

---

## 13. Assumptions

- Users have internet access and a smartphone or web browser.
- Providers are discoverable via Google Places in major Pakistani cities.
- Google Maps provider information (name, address, rating) is reasonably accurate.
- Voice input quality is sufficient for transcription when that feature is used.
- Users permit location access for nearby provider matching.
- Cash-on-service is the payment method — no payment gateway integration required for this prototype.
- External APIs (Google Maps, Supabase, Gmail) remain available during workflow execution.
- `max_daily_bookings` defaults to 4 per provider per day unless explicitly configured.

---

## 14. Baseline Comparison

| Capability | Traditional Platforms | GharFix (AI Agent Workflows) |
|---|---|---|
| Provider discovery | Static listings, manual search | Real-time Google Places + AI ranking |
| Language support | English only | Urdu + Roman Urdu + English + mixed |
| Provider ranking | Distance or rating alone | 7-factor weighted algorithm |
| Job complexity matching | Not supported | Basic / Intermediate / Complex classification |
| Double-booking prevention | Manual or none | Race-condition check at confirmation time |
| Cancellation handling | Manual rebooking | Auto-reschedule with penalty + compensation |
| Waitlist | Not supported | Automatic Supabase waitlist enrollment |
| Dispute resolution | Customer support ticket (1–3 days) | Automated resolution in <1 sec with tiered refund logic |
| Provider performance insight | None | Real-time dashboard with earnings, loyalty, demand forecast |
| Estimated booking time | 15–30 min (calls + WhatsApp) | ~2–4 min (conversation to confirmation) |
| Post-service follow-up | None | En-route → arrived → completed → feedback loop |

---

## 15. Privacy & Security Note

GharFix is designed with privacy-focused principles:

- User locations are used only for provider matching and are not stored beyond the booking record.
- Voice inputs (transcripts) are processed transiently and stored only if the user submits them as feedback evidence.
- Personally identifiable information (name, email) is stored in Supabase only within the booking record and is not shared with third parties.
- No payment card data is collected or stored — all transactions are cash-on-service.
- All secrets, API credentials, Supabase keys, and internal webhook URLs are excluded from public repositories and managed via environment variables.
- Photo evidence (base64 images) submitted during feedback is stored as a JSON string in the `image_base64_data` field and is accessible only to the platform admin.

---

## 16. Limitations

- **Real-time provider availability** depends on Google Places data, which may not reflect a provider's true operational status.
- **Rural provider coverage** is limited — Google Places has sparse results outside major cities.
- **Voice recognition accuracy** may vary across Pakistani accents and dialects.
- **Simulated booking environments** differ from real operational deployments — provider availability slots are partially simulated with seed-based randomisation.
- **Scalability under heavy traffic** has not been stress-tested — n8n is self-hosted and may require horizontal scaling.
- **No real payment gateway** — the platform assumes cash-on-service for this prototype.
- **Provider onboarding** relies entirely on Google Places — providers cannot self-register in this version.

---

## 17. Future Improvements

- Real-time provider GPS tracking integrated into the en-route stage.
- Multilingual voice assistant (Urdu speech-to-text) for hands-free booking.
- Fraud detection layer on the feedback stage to catch rating manipulation.
- Predictive provider ranking using historical booking outcome data.
- Reinforcement learning-based matchmaking that improves with each booking.
- Self-service provider onboarding portal with document verification.
- Real payment gateway integration (JazzCash / EasyPaisa).
- Push notifications (Firebase) replacing email for time-sensitive alerts.

---

## 18. Capstone Concept Mapping

| Concept | Where it lives |
|---|---|
| API endpoints | `server.ts` (`/api/proxy`, `/api/health`) + webhook-triggered n8n workflows (WF1–WF8) |
| Database | Supabase — `bookings`, `waitlist`, `provider_scores` tables (see `/db/`) |
| Background/cron jobs | `/n8n-workflows/WF8b_Provider_Score_Refresh_Nightly.json` — scheduled nightly |
| Caching | Same WF8b workflow — writes to `provider_scores`; dashboard reads the cached row instead of recomputing live |
| LLM integration | `/n8n-workflows/WF1-3_Intent_Provider_Matching_Pricing_Agent.json` — GPT-4o-mini, structured output |
| Reporting (email) | Gmail nodes in WF4, WF5, WF6, WF7 |

---

## Conclusion

GharFix demonstrates a robust implementation of an AI-powered local services platform, using n8n as a set of specialized AI agents that each own one step of the service lifecycle — multilingual intent understanding, 7-factor provider matching, booking, service quality management, dispute resolution, and provider optimization. The React frontend routes each user action to the right workflow through a single proxy endpoint, and every workflow returns a structured reasoning trace documenting its decision, confidence, and data sources. This architecture provides a reliable, accessible, and scalable booking experience for both customers and providers in Pakistan's informal economy.

---

*GharFix — Ghar ka kaam, AI ke saath.*
