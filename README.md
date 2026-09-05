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

- `npm run dev` — Start the development server. **Browse it at
  http://127.0.0.1:3000, not localhost** — see the note under Spotify setup.
- `npm run build` — Build the application for production
- `npm start` — Start the production server (after running `build`)
- `npm run lint` — Run ESLint to check code quality
- `npm run test` — Run the test suite once
- `npm run test:watch` — Run tests in watch mode
- `npm run typecheck` — Run TypeScript type checking
- `npm run format` — Format all code with Prettier
- `npm run seed:demo` — Seed demo events into the linked Supabase project
- `npm run db:replica` — Apply every migration to a throwaway local Postgres
  database and report. `-- --seed` also inserts live-shaped rows; `-- --keep`
  leaves it up. Requires a local PostgreSQL 17. This is how a migration is
  checked **before** it is pushed anywhere.

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
| `TEST_USER_C_EMAIL` / `TEST_USER_C_PASSWORD` | A third account, used as the **partner** in the RLS suite. A partner is a distinct role from a second DJ, and the tests that prove the event link is per-event rather than per-DJ need an account that is neither. | Never, and never set in Vercel — local-only. |
| `TEST_USER_D_EMAIL` / `TEST_USER_D_PASSWORD` | A fourth account, the **other partner**. The assertions that matter most — one partner cannot read the other's Spotify token, cannot write their connection, cannot write their taste profile — need two partners on one event. Three accounts can only approximate that. | Never, and never set in Vercel — local-only. |
| `SPOTIFY_CLIENT_ID` | From the Spotify Developer Dashboard | Never. Name only. |
| `SPOTIFY_CLIENT_SECRET` | From the same app. **Server-only** — never prefix it `NEXT_PUBLIC_`. | Never. Name only. |
| `SPOTIFY_REDIRECT_URI` | `http://127.0.0.1:3000/api/spotify/callback` locally; the production URL once deployed | Never. Name only. |
| `SPOTIFY_TOKEN_KEY` | 32 random bytes, base64. Generate with `openssl rand -base64 32` and paste it in — do not let it pass through any transcript or chat. Encrypts partners' refresh tokens at rest. | Never. Name only. |
| `LASTFM_API_KEY` | Free, instant, from last.fm/api/account/create. Only the API key is needed; the shared secret is for signed writes this app never makes. | Never. Name only. |
| `RUN_MAILER_TESTS` | Optional. Set to `1` to opt into the two `signUp`-calling tests in the RLS suite — omit it for an ordinary test run. | Never. Local-only, and only when deliberately budgeting mailer quota. |

**The service-role key is never used by this app**, in any file, for any
reason: authorization relies on Postgres Row Level Security, and a service-role
key would bypass it entirely.

That claim was nearly given up. A design revision introduced one to protect a
globally-shared genre cache, and it was reversed when the justification turned
out not to hold at this project's scale — the cache is now scoped per event
instead. `docs/submission/security.md` §7.5 records the decision, the argument
that was wrong, and the alternative that was considered.

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
- **P6** Create **four** test users. They back the RLS integration tests: A is a
  DJ, B a second DJ, C a partner, D the other partner. Requires **P5** first —
  the `profiles` table and its trigger must exist before any signup succeeds.
  Put the credentials in `.env.local` as `TEST_USER_A_*` … `TEST_USER_D_*`.

  **Create A, B and C through the app's own `/register` form** — that exercises
  the signup path, which is worth doing at least once. Confirm each by email,
  **one full round trip at a time**.

  **Create D through the Supabase dashboard instead** — *Authentication → Users
  → Add user*, with **Auto Confirm User** ticked. No email is sent, so it costs
  no quota, and the `profiles` trigger fires on `auth.users` insert regardless
  of how the row was created. Following the `/register` route for a fourth
  account buys nothing and will almost certainly fail.

  **Budget these deliberately.** Supabase's built-in mailer is capped at **2
  emails per hour, project-wide**, and 1 per minute — shared across signup,
  recovery, everything. Three accounts in one sitting will hit it. The failure
  reads as `AuthApiError: over_email_send_rate_limit` (429), which is a quota,
  not a defect in the app.

  **The two `signUp`-calling tests in `src/lib/auth/rls.integration.test.ts`
  are opt-in, not run by default** — they are skipped unless `RUN_MAILER_TESTS=1`
  is set, precisely so an ordinary `npm test`/`npm run gate` never spends this
  quota by accident. Set that variable only when you specifically intend to
  exercise those two tests, and expect to wait out the cap afterward. Account D
  is still created through the dashboard regardless, since it needs no
  confirmation email at all.

  **`src/lib/live/guest.integration.test.ts` needs `npm run seed:demo` to have
  been run at least once** against the linked project first — it reads the
  seeded `Sara & Daniel`, `Claire & Ben` and `Noa & Eitan` events by name.
  **Do not run the full suite immediately before a live manual walk**: the
  integration suites reset `event_partners`, which cascades and deletes any
  manually-connected guest sessions or Spotify state for the same event.

### Spotify setup

Needed for the search and streaming features. Skip it and the rest of the app
still runs.

- **S1** The Spotify account that owns the app must hold an **active Premium
  subscription**, or a development-mode app stops working entirely.
- **S2** Create an app at developer.spotify.com/dashboard. Copy the Client ID
  and Client Secret into `.env.local`.
- **S3** Register the redirect URI **exactly**, including case and trailing
  slash: `http://127.0.0.1:3000/api/spotify/callback`.

  **It must be `127.0.0.1`, never `localhost`.** Spotify removed HTTP redirect
  URIs and localhost aliases on 2025-11-27; loopback IP literals over HTTP are
  the only remaining HTTP exception. Browse the app at `http://127.0.0.1:3000`
  too, or the OAuth `state` cookie will not match the callback's host.

- **S4** Add each person who will connect a Spotify account under **Settings →
  User Management**, by name and by the email address **on their Spotify
  account** — which is often not their usual one, and is shown at
  spotify.com/account/overview.

  **There are five slots, for the life of the app.** A development-mode app
  authorises at most five Spotify users; there is no API to manage the list, and
  extended quota has been organisations-only since 2025-05-15 with a 250k
  monthly-active-user threshold. Budget the slots: the demo couple, the
  developer, and two spare.

  An un-allowlisted user completes the whole OAuth flow **successfully** and
  then gets `403 User not registered in the Developer Dashboard` on every API
  call. If you see that, the fix is this step, not the code.

- **S5** Before the first deploy — not before local development — register the
  production redirect URI and set `SPOTIFY_REDIRECT_URI` in Vercel. See
  `docs/submission/deployment.md`.

MusicBrainz needs no key or signup, only a descriptive `User-Agent`, which is
code rather than configuration.
