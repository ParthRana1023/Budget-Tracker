# SaveFirst

> A privacy-conscious, savings-first personal budget tracker that calculates your daily safe-to-spend, protects your savings target on payday, and isolates variable income.

[![CI](https://github.com/ParthRana1023/Budget-Tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/ParthRana1023/Budget-Tracker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

SaveFirst flips traditional budgeting on its head. Instead of tracking expenses backward at the end of the month, SaveFirst sets aside your savings target and fixed commitments the moment your salary lands, providing a real-time **Safe to Spend** per day for the rest of your cycle.

---

## Features

- **Save-First Allocation**: Sets aside your target savings percentage immediately on payday before budgeting flexible spending.
- **Dynamic Safe to Spend**: Real-time daily spending allowance calculated across your actual pay cycle with instant visual feedback.
- **Pay Cycle Intelligence**:
  - Flexible paydays (1st–28th, or 31st for the last day of the month).
  - Effective-dated plan changes: schedule salary, payday, or savings % adjustments for _This cycle_ or _Next cycle_.
  - Full audit history of plan changes with instant 15-minute undo capability.
- **Variable Pay & Windfalls**: Bonuses and incentives are held safely aside until received in your bank, then split across savings goals, an annual bills reserve, and everyday spending.
- **Early Income Handling**: Income arriving 1–5 days before payday can optionally count toward the next cycle without skewing current safe-to-spend.
- **Multiple Currencies**:
  - Pick a base currency from 30 (the ones the ECB publishes rates for). It locks after your first entry.
  - Log expenses, bills, category limits and goal targets in any of them. Each keeps what you typed and the rate on the day your cycle started.
  - Bills, limits and goal targets re-price at each new cycle's rate; logged entries keep theirs.
  - If the rates service is down, the last cached rate is used and you can type your own.
- **Payment Methods**: Tag expenses with how they were paid (card, UPI, cash and more), with defaults per recurring bill, a Ledger filter and a Reports breakdown.
- **Installable App & Push**: Installs as a PWA with offline handling and an update prompt, plus optional Web Push reminders for bills and a weekly summary.
- **Spending Habits & Analytics**:
  - Month-over-month comparisons, savings rate tracking, and spending pace curves.
  - Interactive calendar heatmaps and weekday spending distributions.
  - Top payees breakdown and next-cycle predictive budget recommendations.
- **Account & Security**:
  - Password and magic link authentication with rate-limited server endpoints.
  - Optional Google OAuth identity linking/unlinking.
  - Active device session management (sign out individual devices or all other sessions).
  - Geographic sign-in history tracking without storing raw IP addresses.
- **Data Ownership**:
  - Full account export in structured JSON format (`savefirst-my-data.json`).
  - Two-way CSV export and import with preview, deduplication, and row-level validation.
  - Complete permanent account deletion with automated avatar storage cleanup.
- **Custom Preferences**:
  - Number formatting: Indian (`1,00,000.00`), International (`100,000.00`), and European (`100.000,00`).
  - Weekday start preference (Monday or Sunday).
  - Dark, light, and system theme support.

---

## Tech Stack

| Layer               | Technologies                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend**        | [Next.js](https://nextjs.org/) 16 (App Router), [React](https://react.dev/) 19, [Tailwind CSS](https://tailwindcss.com/) 4, Lucide Icons |
| **Backend & DB**    | [Supabase](https://supabase.com/) (PostgreSQL 15+), Row-Level Security (RLS), PL/pgSQL stored procedures                                 |
| **Auth & Security** | Supabase Auth via `@supabase/ssr` (PKCE, cookie sessions)                                                                                |
| **Background Jobs** | Supabase Edge Functions (Deno), `pg_cron`, `pg_net`, Resend API, Web Push (VAPID)                                                        |
| **Exchange Rates**  | [Frankfurter](https://frankfurter.dev/) (ECB reference rates), cached in Postgres                                                        |
| **Hosting**         | Vercel, with Vercel Analytics and Speed Insights                                                                                         |
| **Tooling & Tests** | TypeScript, Playwright (E2E), Node.js native test runner, Prettier                                                                       |

---

## Architecture

```text
                    ┌──────────────────────────────────────────────┐
                    │               Client (Next.js)               │
                    │  App Router · SSR Pages · Client Components  │
                    └───────────────┬──────────────┬───────────────┘
                                    │              │
                   Direct Supabase  │              │ Internal API Routes
                   Client with RLS  │              │ (/api/auth, /api/rates, …)
                                    ▼              ▼
                    ┌──────────────────────────────────────────────┐
                    │               Supabase Backend               │
                    │  Auth · Postgres DB (RLS) · Storage (Avatars)│
                    └──────────────────────┬───────────────────────┘
                                           │
                                           │ Scheduled Cron
                                           ▼
                    ┌──────────────────────────────────────────────┐
                    │      Supabase Edge Functions / Resend        │
                    │   Hourly notification job (quiet hours aware)│
                    └──────────────────────────────────────────────┘
```

All financial figures are stored as `bigint` **minor units** of your base currency (paise for INR, cents for USD, whole yen for JPY), so there are no floating-point errors. A foreign amount is converted once, when saved, and totals add the stored base amounts, so rounding never drifts. Display formatting (e.g. lakh separator or thousand separator) is a presentation-layer preference only.

---

## Getting Started

### Prerequisites

- **Node.js**: v22+
- **npm**: v10+
- **Supabase CLI**: For local database development

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/ParthRana1023/Budget-Tracker.git
   cd Budget-Tracker
   ```

2. Install dependencies for all workspaces:

   ```bash
   npm install
   ```

3. Start a local Supabase (needs Docker). `client/.env.development` already points `npm run dev` at it:

   ```bash
   npx supabase start --workdir server
   ```

4. Optional: to use a hosted Supabase project instead, or to add secrets, create `client/.env.local`
   from the template. It overrides the committed defaults and is never committed:

   ```bash
   cp client/.env.example client/.env.local
   ```

5. Start the app (`http://localhost:3000`):

   ```bash
   npm --workspace=client run dev
   ```

---

## Environment Variables

Each folder has a committed template (`.env.example`) and committed, secret-free defaults for
local development (`.env.development`) and production builds (`.env.production`). Your own values
and every secret go in the uncommitted files shown below, or in the host's environment settings,
which override everything.

| Folder                                   | Your values (not committed)      | Production                                          |
| ---------------------------------------- | -------------------------------- | --------------------------------------------------- |
| `client/` (Next.js)                      | `client/.env.local`              | Vercel › Project › Settings › Environment Variables |
| `server/supabase/functions/` (email job) | `server/supabase/functions/.env` | `npx supabase secrets set --env-file …`             |

No env file is needed at the repo root.

### Client (`client/.env.example`)

| Variable                               | Required    | Description                                                             |
| -------------------------------------- | ----------- | ----------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Yes         | Supabase project URL                                                    |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes         | Supabase anonymous / public API key                                     |
| `SUPABASE_SECRET_KEY`                  | Server-only | Supabase secret key: records sign-in history and caches exchange rates  |
| `NEXT_PUBLIC_GOOGLE_AUTH`              | Optional    | Set to `1` to enable Google OAuth sign-in and account linking           |
| `NEXT_PUBLIC_EMAIL_NOTIFICATIONS`      | Optional    | Set to `1` to display email notification controls in Settings           |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`         | Optional    | Public VAPID key for Web Push. Empty hides push in Settings             |
| `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`  | Server-only | Same key pair's private half and `mailto:` contact; used by Send a test |

### Email job (`server/supabase/functions/.env.example`)

| Variable                                 | Description                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `RESEND_API_KEY`                         | Resend API key                                                             |
| `EMAIL_FROM`                             | Sender address on a domain verified in Resend                              |
| `CRON_SECRET`                            | Shared secret; must match the one in the cron SQL                          |
| `APP_URL`                                | The web app's address, used for links in the emails                        |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push key pair (`npx web-push generate-vapid-keys`). Empty = email only |
| `VAPID_SUBJECT`                          | Contact for push services, as a `mailto:` link                             |

---

## Database & Setup

The database schema, RLS policies, views, triggers, and RPC functions are managed in `server/supabase/`.

### Quick Setup (One Script)

To initialize or completely reset your database schema:

1. Open your Supabase Project SQL Editor.
2. Run the script located at [server/supabase/savefirst_full_setup.sql](server/supabase/savefirst_full_setup.sql).
3. The script is idempotent and transactional: it cleanly drops existing application tables and builds the complete schema from scratch.

### Setup Checklist

| What                                       | Where                               | Why                                                                                                                                                           |
| ------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vercel project**                         | Vercel › Settings › Build           | Framework Preset `Next.js`, Root Directory `client`, Output Directory empty. One project serves the app and its API routes.                                   |
| **Run `savefirst_full_setup.sql`**         | Supabase SQL editor                 | Creates full schema, tables, views, RLS policies, and RPC functions.                                                                                          |
| **`NEXT_PUBLIC_SUPABASE_URL`**             | Vercel / Client env                 | Connects application to the Supabase backend.                                                                                                                 |
| **`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`** | Vercel / Client env                 | Public client access token.                                                                                                                                   |
| **`SUPABASE_SECRET_KEY`**                  | Vercel (Server-only env)            | Records sign-in audit logs and caches exchange rates via secure server routes. Without it, rates are fetched on every request.                                |
| **VAPID keys (optional)**                  | Vercel + Edge Function secrets      | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` in Vercel; `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` as function secrets. |
| **Raise sign-in rate limits**              | Supabase › Auth › Rate Limits       | Password and code sign-ins go through the app's server, so every user shares its IP's limit.                                                                  |
| **`NEXT_PUBLIC_GOOGLE_AUTH=1`**            | Vercel / Client env                 | Enables Google Sign-In and identity linking UI.                                                                                                               |
| **Redirect URLs**                          | Supabase › Auth › URL Configuration | Add `<APP_URL>/**` and `http://localhost:3000/**`. The wildcard is needed because the callback carries `?next=`.                                              |
| **Deploy `send-notifications`**            | Supabase Edge Functions             | Deploy background email worker with `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET`, `APP_URL`.                                                                 |
| **Schedule Notifications Cron**            | Supabase SQL editor                 | Run [server/supabase/cron/send-notifications.sql](server/supabase/cron/send-notifications.sql) with your project URL and keys.                                |
| **`NEXT_PUBLIC_EMAIL_NOTIFICATIONS=1`**    | Vercel / Client env                 | Reveals email notification toggles in Settings once the worker is active.                                                                                     |

---

## Testing

```bash
# Unit tests across all timezones (UTC, Asia/Kolkata, America/Los_Angeles, Pacific/Auckland).
# Covers client/src and the email job's logic in server/supabase/functions.
npm run test:unit

# Check code formatting with Prettier
npm run format:check

# Run TypeScript type check
npm --workspace=client run lint

# Database tests (pgTAP, needs the local Supabase)
npm run test:db

# End-to-end tests (Playwright). They refuse to run against a hosted Supabase:
# point NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY at the local stack, and set
# SUPABASE_SECRET_KEY to its SECRET_KEY so sign-in history is covered.
npm run test:e2e
```

---

## Project Structure

```text
Budget-Tracker/
├── client/                     # Next.js frontend application
│   ├── public/                 # Static assets, PWA manifest, service worker
│   ├── src/
│   │   ├── app/                # App Router (pages, error boundaries, API routes)
│   │   │   ├── (auth)/         # Login, signup, password reset routes
│   │   │   ├── api/            # Server endpoints (/api/auth, /api/account, /api/rates, /api/log, /api/budget, /api/health)
│   │   │   ├── auth/           # OAuth and token exchange callbacks
│   │   │   ├── dashboard/      # Safe to spend, Until Payday, Ledger, Budgets
│   │   │   ├── onboarding/     # 5-step interactive setup flow
│   │   │   └── settings/       # Settings and Account management views
│   │   ├── components/         # React UI components & dialog popups
│   │   ├── lib/                # Pure business logic (cycle, periods, money, reports, log)
│   │   └── utils/supabase/     # Client, server, middleware, and admin Supabase instances
│   └── tests/                  # Playwright E2E test suites
├── server/                     # Database and background jobs (no Node server; the API lives in client/)
│   └── supabase/
│       ├── cron/               # Scheduled pg_cron notification scripts
│       ├── functions/          # Deno Edge Functions (send-notifications, with its unit tests)
│       ├── migrations/         # Versioned SQL migration files
│       ├── tests/database/     # pgTAP database tests
│       └── savefirst_full_setup.sql # Consolidated idempotent database setup
├── plans/                      # Architecture plans and implementation specs
└── package.json                # Root workspace configuration
```

---

## Security & License

- **Security**: Please review our [Security Policy](SECURITY.md) for vulnerability reporting guidelines.
- **License**: This project is licensed under the [MIT License](LICENSE).
