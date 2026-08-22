# GharFix

GharFix is an AI-assisted home-services booking platform. The repository contains the React/Vite application, the Express proxy used to forward requests to n8n, and the n8n workflows that implement intent matching, booking, service quality, disputes, cancellations, provider optimization, and scheduled provider-score refreshes.

## Run Locally

**Prerequisites:** Node.js and npm.

1. Install dependencies:
   `npm install`
2. Create `.env.local` and set the following variable:
   `N8N_WEBHOOK_BASE_URL` — your n8n instance's webhook base URL. It defaults to the maintainer's instance when unset.
3. Run the app:
   `npm run dev`

The server also exposes `/api/health` for a basic health check and `/api/proxy` for webhook forwarding. The proxy preserves the existing request enrichment and response handling behavior.

## Workflow Layout

The n8n workflows are organized under `/n8n-workflows/` using capstone-oriented numbering:

- `WF1-3_Intent_Provider_Matching_Pricing_Agent.json`
- `WF4_Booking_Agent.json`
- `WF5_Service_Quality_Loop.json`
- `WF6_Dispute_Escalation_Handler.json`
- `WF7_Cancellation_Auto_Reschedule.json`
- `WF8_Provider_Optimization_Agent.json`
- `WF8b_Provider_Score_Refresh_Nightly.json`

Database schemas are under `/db/` for `bookings`, `waitlist`, and `provider_scores`.

## 6. Autonomous Workflows (n8n Tools)

The core booking and operations flows are triggered through n8n webhooks. They cover intent, provider, and price matching; booking; service-quality follow-up; dispute and escalation handling; cancellation and automatic rescheduling; and provider optimization.

## 6b. Provider Score Refresh (Nightly) — WF8b

WF8b runs on a nightly n8n schedule trigger instead of a live webhook. It fetches all bookings once, computes optimization scores for every provider in a single batch pass using the same logic as WF8, and upserts the results into the new `provider_scores` Supabase table. The provider dashboard can then read a precomputed score instead of recalculating it on every request; this table doubles as the platform's caching layer.

## Security and Configuration Notes

Raw Supabase JWT values in the workflow HTTP Request header values have been replaced with `YOUR_SUPABASE_ANON_KEY`. OpenAI, Google Maps, and Gmail credential references remain n8n credential-store references and were not modified. The n8n base URL is configurable through `N8N_WEBHOOK_BASE_URL`.

## 16. Capstone Concept Mapping

| Concept | Where it lives |
|---|---|
| API endpoints | `server.ts` (`/api/proxy`, `/api/health`) + webhook-triggered n8n workflows (WF1–WF8) |
| Database | Supabase — `bookings`, `waitlist`, `provider_scores` tables (see `/db/`) |
| Background/cron jobs | `/n8n-workflows/WF8b_Provider_Score_Refresh_Nightly.json` — scheduled nightly |
| Caching | Same WF8b workflow — writes to `provider_scores`; dashboard reads the cached row instead of recomputing live |
| LLM integration | `/n8n-workflows/WF1-3_Intent_Provider_Matching_Pricing_Agent.json` — GPT-4o-mini, structured output |
| Reporting (email) | Gmail nodes in WF4, WF5, WF6, WF7 |

## Conclusion

This repository keeps the GharFix application and its automation pipeline together while making the workflow inventory, database schemas, configuration boundary, and capstone concepts explicit. Secrets that belong in the deployment environment or n8n credential store are not published as raw values.
