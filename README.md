# Spinit

A live-event song-request product for weddings and parties. Guests scan a QR code to suggest and vote on songs from their phones, the DJ sees a ranked queue that explains each pick, and the couple keeps a playlist of everything played.

## Prerequisites

- Node.js 20.x or later
- npm

## Installation

```bash
npm install
```

## Available Scripts

- `npm run dev` — Start the development server at http://localhost:3000
- `npm run build` — Build the application for production
- `npm start` — Start the production server (after running `build`)
- `npm run lint` — Run ESLint to check code quality
- `npm run test` — Run the test suite once
- `npm run test:watch` — Run tests in watch mode
- `npm run typecheck` — Run TypeScript type checking
- `npm run format` — Format all code with Prettier

## Environment Variables

Copy `.env.example` to `.env.local` and fill in the values. None of these are
committed; `.env.example` documents the names only.

| Name | Value | Committed? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | Never. Name only, in `.env.example`. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable (anon) key | Never. Name only. |
| `SITE_URL` | This app's own origin (e.g. `http://localhost:3000` or the Vercel production URL) — no trailing slash | Never. Name only. |
| `TEST_USER_A_EMAIL` / `TEST_USER_A_PASSWORD` | Credentials for a pre-created RLS test user A, registered through the app's own `/register` form | Never, and never set in Vercel — local-only, used only to run the integration suite. |
| `TEST_USER_B_EMAIL` / `TEST_USER_B_PASSWORD` | Credentials for a pre-created RLS test user B, registered through the app's own `/register` form | Never, and never set in Vercel — local-only, used only to run the integration suite. |

The service-role key is never used by this app, in any file, for any reason:
authorization relies on Postgres Row Level Security, and a service-role key
would bypass it entirely.

### Supabase project setup

- **P1** Create a Supabase project on the free tier.
- **P2** Google OAuth sign-in is **deferred** to a later phase (tracked in
  issue #2) and is not part of this app today; there is no Google Cloud OAuth
  client to configure yet.
- **P3** Push the Site URL and the exact Redirect URL allowlist as code:
  `supabase/config.toml` plus `supabase config push`. The allowlist should be
  exactly the app's own `/auth/callback` URL (e.g.
  `http://localhost:3000/auth/callback` locally).
- **P4** Customising the signup confirmation email template is **not
  available** on the Supabase free tier with the default email provider (the
  Management API rejects it with a 400). This app uses Supabase's stock
  confirmation email as-is; no template setup is needed or possible here.
- **P5** Install the Supabase CLI, then `supabase init` and `supabase link`
  the project to this repo so schema migrations can be applied and verified.
  Then run `supabase db push` to apply every migration under
  `supabase/migrations/` to the linked project (not just the first one —
  re-run `supabase db push` again whenever a new migration file is added).
  Do this before running `npm run dev` for the first time: without it, the
  `profiles` table and its triggers don't exist, and the whole auth flow
  breaks.
- **P6** Register two test users through the app's own `/register` form (not
  the Supabase dashboard), confirm each by email, one full round trip at a
  time, and put their credentials in `.env.local` as `TEST_USER_A_*` /
  `TEST_USER_B_*` above. These back the RLS integration tests. Requires **P5**
  to have run first — the `profiles` table and its trigger must exist before
  a signup can succeed.
