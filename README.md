# EstateFlow CRM

EstateFlow CRM is a mobile-first Real Estate CRM application with production-ready architecture patterns, dry-run integration adapters, and Supabase-ready SQL schema.

This repository runs as a Vite + React implementation for rapid local development while keeping Next.js-compatible service boundaries.

## Architecture Summary

- `src/App.tsx`: Mobile-first application shell, role-aware UI, dashboard, leads, properties, follow-ups, attendance, social planning, settings, and reports.
- `src/types.ts`: Domain model types.
- `src/schemas.ts`: Zod validation schemas for lead intake, property creation, and follow-ups.
- `src/services/*`: Adapter service layer for calls, messages, email, lead assignment, property sharing, attendance, social posts, and webhook intake.
- `src/data/seed.ts`: Seed data generator for organization, users, leads, properties, calls, follow-ups, attendance, and social posts.
- `supabase/migrations/*.sql`: Database schema + RLS policies.
- `supabase/seed.sql`: SQL seed starter.

## Features Implemented

- Role-aware login switcher: admin, sales manager, sales agent, field executive, social media manager.
- Mobile-first UI with bottom navigation.
- Dashboard metrics and quick actions.
- Manual lead creation with validation.
- Webhook simulation flow equivalent to `POST /api/webhooks/leads`.
- Round-robin and least-busy assignment modes.
- Instant call bridge workflow simulation and call log creation.
- Lead detail panel with one-click call, one-click follow-up (WhatsApp/SMS/email), one-click property share, status update, timeline, recommendations.
- Property inventory and add listing workflow.
- Follow-up scheduler with complete/snooze actions.
- Attendance check-in/check-out with browser geolocation.
- Social media draft and scheduling module with AI caption placeholder.
- Team invite and role assignment.
- Integration settings panel with dry-run / production switch.
- Reporting widgets (source, win/loss, shared properties).

## Local Setup

1. Install dependencies:
`npm install`

2. Copy env variables:
`cp .env.example .env`

3. Start app:
`npm run dev`

4. Build for production:
`npm run build`

## Supabase Setup

1. Create a Supabase project.
2. Apply migration SQL from `supabase/migrations/202606280001_estateflow_schema.sql`.
3. Run `supabase/seed.sql`.
4. Configure JWT custom claim `organization_id` in your auth pipeline to enforce RLS.

## Twilio Setup

1. Create a Twilio project.
2. Buy a voice-enabled number and WhatsApp-enabled sender.
3. Configure env vars:
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `TWILIO_WHATSAPP_SENDER`
4. Keep app in `dry-run` mode until credentials and webhooks are verified.

## Webhook Testing (curl)

Use this payload to test lead ingestion semantics:

```bash
curl -X POST http://localhost:3000/api/webhooks/leads \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: local-secret" \
  -d '{
    "fullName": "Rahul Sharma",
    "phone": "+919999999999",
    "email": "rahul@example.com",
    "source": "36 Acre",
    "propertyType": "Apartment",
    "budgetMin": 7500000,
    "budgetMax": 12000000,
    "preferredLocation": "Gurgaon",
    "notes": "Looking for 3BHK near Golf Course Road"
  }'
```

## Vercel Deployment

1. Push repository to Git provider.
2. Import project in Vercel.
3. Add environment variables from `.env.example`.
4. Connect Supabase and redeploy.

## Notes

- Call, message, and email adapters are intentionally abstracted and support dry-run mode.
- For a full Next.js 15 deployment, move `src/services/webhookService.ts` logic into `/app/api/webhooks/leads/route.ts` and server actions.
