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
| **Auth & Security** | Supabase SSR Auth (PKCE flow, HttpOnly secure cookies), Argon2/bcrypt                                                                    |
| **Background Jobs** | Supabase Edge Functions (Deno), `pg_cron`, `pg_net`, Resend API                                                                          |
| **Tooling & Tests** | TypeScript, Playwright (E2E), Node.js native test runner, Prettier                                                                       |

---

## Architecture

```mermaid
                    ┌──────────────────────────────────────────────┐
                    │               Client (Next.js)               │
                    │  App Router · SSR Pages · Client Components  │
                    └───────────────┬──────────────┬───────────────┘
                                    │              │
                   Direct Supabase  │              │ Internal API Routes
                   Client with RLS  │              │ (/api/auth, /api/account)
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

All financial figures are stored internally as **paise** (`bigint`) in INR to guarantee precision without floating-point inaccuracies. Display formatting (e.g. lakh separator or thousand separator) is strictly a presentation-layer preference.

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

3. Set up environment variables:

   ```bash
   cp .env.example .env.local
   ```

   Configure the variables as described in the [Environment Variables](#environment-variables) section below.

4. Start local development:

   ```bash
   # Run frontend client (http://localhost:3000)
   npm --workspace=client run dev
   ```

---

## Environment Variables

### Client (`client/.env.local`)

| Variable                               | Required    | Description                                                        |
| -------------------------------------- | ----------- | ------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | Yes         | Supabase project URL                                               |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes         | Supabase anonymous / public API key                                |
| `SUPABASE_SECRET_KEY`                  | Server-only | Supabase service role key (used for writing sign-in audit history) |
| `NEXT_PUBLIC_GOOGLE_AUTH`              | Optional    | Set to `1` to enable Google OAuth sign-in and account linking      |
| `NEXT_PUBLIC_EMAIL_NOTIFICATIONS`      | Optional    | Set to `1` to display email notification controls in Settings      |

---

## Database & Setup

The database schema, RLS policies, views, triggers, and RPC functions are managed in `server/supabase/`.

### Quick Setup (One Script)

To initialize or completely reset your database schema:

1. Open your Supabase Project SQL Editor.
2. Run the script located at [server/supabase/savefirst_full_setup.sql](file:///server/supabase/savefirst_full_setup.sql).
3. The script is idempotent and transactional: it cleanly drops existing application tables and builds the complete schema from scratch.

### Setup Checklist

| What                                       | Where                               | Why                                                                                                                                    |
| ------------------------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Run `savefirst_full_setup.sql`**         | Supabase SQL editor                 | Creates full schema, tables, views, RLS policies, and RPC functions.                                                                   |
| **`NEXT_PUBLIC_SUPABASE_URL`**             | Vercel / Client env                 | Connects application to the Supabase backend.                                                                                          |
| **`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`** | Vercel / Client env                 | Public client access token.                                                                                                            |
| **`SUPABASE_SECRET_KEY`**                  | Vercel (Server-only env)            | Records sign-in audit logs via secure server route.                                                                                    |
| **Raise sign-in rate limits**              | Supabase › Auth › Rate Limits       | Server routes proxy authentication; ensure adequate rate limits per IP.                                                                |
| **`NEXT_PUBLIC_GOOGLE_AUTH=1`**            | Vercel / Client env                 | Enables Google Sign-In and identity linking UI.                                                                                        |
| **Redirect URLs**                          | Supabase › Auth › URL Configuration | Add `<APP_URL>/auth/callback` and `<APP_URL>/auth/confirm`.                                                                            |
| **Deploy `send-notifications`**            | Supabase Edge Functions             | Deploy background email worker with `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET`, `APP_URL`.                                          |
| **Schedule Notifications Cron**            | Supabase SQL editor                 | Run [server/supabase/cron/send-notifications.sql](file:///server/supabase/cron/send-notifications.sql) with your project URL and keys. |
| **`NEXT_PUBLIC_EMAIL_NOTIFICATIONS=1`**    | Vercel / Client env                 | Reveals email notification toggles in Settings once the worker is active.                                                              |

---

## Testing

The project maintains comprehensive test coverage across both workspaces:

```bash
# Run unit tests across all timezones (UTC, Asia/Kolkata, America/Los_Angeles, Pacific/Auckland)
npm --workspace=client run test:unit

# Run server unit tests
npm --workspace=server test

# Check code formatting with Prettier
npm run format:check

# Run TypeScript type check
npm --workspace=client run lint
```

---

## Project Structure

```code
Budget-Tracker/
├── client/                     # Next.js frontend application
│   ├── public/                 # Static assets, PWA manifest, service worker
│   ├── src/
│   │   ├── app/                # App Router (pages, error boundaries, API routes)
│   │   │   ├── (auth)/         # Login, signup, password reset routes
│   │   │   ├── api/            # Server endpoints (/api/auth, /api/account, /api/log)
│   │   │   ├── auth/           # OAuth and token exchange callbacks
│   │   │   ├── dashboard/      # Safe to spend, Until Payday, Ledger, Budgets
│   │   │   ├── onboarding/     # 5-step interactive setup flow
│   │   │   └── settings/       # Settings and Account management views
│   │   ├── components/         # React UI components & dialog popups
│   │   ├── lib/                # Pure business logic (cycle, periods, money, reports, log)
│   │   └── utils/supabase/     # Client, server, middleware, and admin Supabase instances
│   └── tests/                  # Playwright E2E test suites
├── server/                     # Backend services & database configurations
│   ├── src/                    # Standalone calculation service & Express API
│   ├── supabase/
│   │   ├── cron/               # Scheduled pg_cron notification scripts
│   │   ├── functions/          # Deno Edge Functions (send-notifications)
│   │   ├── migrations/         # Versioned SQL migration files
│   │   └── savefirst_full_setup.sql # Consolidated idempotent database setup
│   └── test/                   # Backend calculation & notification unit tests
├── plans/                      # Architecture plans and implementation specs
└── package.json                # Root workspace configuration
```

---

## Security & License

- **Security**: Please review our [Security Policy](SECURITY.md) for vulnerability reporting guidelines.
- **License**: This project is licensed under the [MIT License](LICENSE).
