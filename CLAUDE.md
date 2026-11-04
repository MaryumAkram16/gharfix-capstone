# Project
GharFix (Khadmat AI): AI home-services booking platform for Pakistan.
Stack today: React/Vite + Express (server.ts proxies /api/proxy to n8n), 8 n8n workflows, Supabase REST (tables: bookings, provider_scores, waitlist).
Situation: the n8n host (n8ndigitalstudio.duckdns.org) is DEAD (free hosting ended). We are porting the backend to Vercel serverless TypeScript. The n8n JSON files stay in the repo as the design record and must not be deleted.
Purpose: portfolio piece for the Techfektor "AI Builder" job (self-healing automations, tested, shipped). Start with the BOOKING flow.

# File map
- n8n-workflows/WF1-3_Intent_Provider_Matching_Pricing_Agent.json  -> endpoints khadmat-intent, khadmat-provider-match
- n8n-workflows/WF4_Booking_Agent.json                              -> khadmat-booking (get_slots, confirm)   <- START HERE
- n8n-workflows/WF5_Service_Quality_Loop.json                       -> khadmat-quality
- n8n-workflows/WF6_Dispute_Escalation_Handler.json                 -> khadmat-dispute
- n8n-workflows/WF7_Cancellation_Auto_Reschedule.json               -> khadmat-reschedule
- n8n-workflows/WF8_Provider_Optimization_Agent.json                -> khadmat-provider-dashboard
- n8n-workflows/WF8b_Provider_Score_Refresh_Nightly.json            -> nightly score refresh
- db/*.sql  (bookings, provider_scores, waitlist schemas)
- src/ (frontend), server.ts (local dev proxy)
- Frontend calls everything through POST /api/proxy with { endpoint, ...body }. Keep request and response JSON shapes identical.

# Target layout (create as you go)
api/<endpoint>.ts   one Vercel function per webhook
lib/<area>/*.ts     shared, testable logic
tests/              Vitest
db/001_*.sql ...    numbered migrations (never edit the original schema files)
.github/workflows/  scheduled jobs (Vercel Hobby cron is daily only)

# Replacements (no credit card available)
- Google Maps Geocode/Places/Distance Matrix -> OpenStreetMap (Nominatim/Overpass) or a Supabase providers table
- OpenAI gpt-4o-mini intent parsing -> Gemini via GEMINI_API_KEY
- n8n Gmail node -> Nodemailer with Gmail SMTP app password
- Email sender sits behind an interface so it can be swapped.

# Rules
- Never print, commit or copy Supabase keys. All secrets come from env vars; keep .env.example current with names only.
- Build JSON bodies with JSON.stringify, never by interpolating user text into a JSON string.
- Slot format is inconsistent ("09:00" vs "4:00 PM"). Normalise to 24h "HH:MM" at every entry point.
- Small changes. After each: what changed, how you verified it (run it), what could still break. Never claim "works" without running tests.
- Tests use user_email ending @example.test and booking ids starting BK-TEST-. Never touch real customer rows.
- Do not edit the original n8n JSON or db/*.sql schema files.
