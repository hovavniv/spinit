# Deployment — getting Spinit onto a public Vercel URL

Deliverable 1 is a live public URL; this is deliverable 9's deployment half.

**Deployment is deliberately scheduled last**, after the feature work. This
document exists so that when it happens it takes twenty minutes rather than an
afternoon: the investigation is already done, the variables are already
enumerated, and the three failure modes that bite silently are already written
down. It is written to be followed start to finish by someone who has never
deployed this app.

Every line is marked **[verified]** — run or read against this repo — or
**[unverified]**, meaning it depends on a dashboard, a hosted setting or a first
deploy that nobody has done yet. The unverified lines are where the surprises
will be.

Nothing has been deployed. There is no Vercel project yet, and nothing in the
codebase depends on one: the Spotify authorization-code flow works against a
registered `127.0.0.1` loopback redirect, search is server-to-server, and
Supabase is reached over HTTPS from local development exactly as it would be
from production. Deployment is a task, not a prerequisite.

---

## 0. What the app needs to boot

**Required — the app cannot serve an authenticated page without these:**

| Variable | Where it comes from | Missing → |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | Login and `/dashboard` throw; homepage still renders |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Same page (the anon/publishable key) | Same |
| `SITE_URL` | The Vercel URL, **no trailing slash** | `siteUrl()` throws `SITE_URL is not set` on register, login and the auth callback |

**Do NOT set these yet:**

- `SUPABASE_SERVICE_ROLE_KEY` — belongs to plan C. Plan A and B do not use it,
  and adding it early puts a full-bypass key in the environment for no reason.
- `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` / `SPOTIFY_REDIRECT_URI` —
  plan C. **You are not blocked on a Spotify secret to get a URL up.**
- `TEST_USER_A/B/C_*`, `SEED_DJ_*` — local development and the integration
  suite only. They are credentials; they do not belong in a deployment.

**[verified]** `grep` over `src/`, `scripts/` and `next.config.ts` for
`process.env.*` returns exactly: the two Supabase vars, `SITE_URL`, the
`TEST_USER_*` and `SEED_DJ_*` pairs, plus `NODE_ENV` and `TZ` which the platform
sets itself. There is no other hidden requirement.

---

## 1. Before you touch Vercel

- [ ] **[verified]** A clean production build succeeds. `rm -rf .next && npm run
      build` compiles, typechecks and generates 10 static pages, exit 0. This
      was worth checking: `npm run typecheck` silently depends on `.next/`
      existing, so a fresh clone is the case that matters, and it passes.

- [ ] **[verified]** Nothing reads the database at build time. Every
      authenticated route builds as `ƒ (Dynamic)` — `/dashboard`,
      `/events/[id]`, `/events/[id]/recap`, `/events/past`, `/auth/callback`.
      Only `/`, `/login`, `/register`, `/design/dashboard` and `/_not-found`
      prerender, and none of them call Supabase.

      **The consequence matters more than the fact: a missing environment
      variable will NOT fail the build.** It will build green and fail at
      runtime. Do not treat a successful deploy as proof the vars are right.

- [ ] **[verified]** `.env.example` is committed (`.gitignore` has `.env*`
      followed by `!.env.example`), so a grader can see what is needed without
      seeing any secret.

- [ ] **[unverified]** Consider pinning Node. There is no `engines` field, no
      `.nvmrc` and no `.node-version`, so Vercel picks its own default. Local
      development is on Node 24 and Next 16.3.3 requires ≥ 20.9. This will
      probably just work; pinning removes the "probably".

---

## 2. Create the project

- [ ] Import the GitHub repo at vercel.com → Add New → Project.
- [ ] Framework preset: **Next.js** (auto-detected). Leave build command,
      output directory and install command at their defaults — this repo needs
      no overrides.
- [ ] **Set the environment variables before the first deploy** (step 3). A
      deploy without them builds green and then fails on login, which is a
      confusing way to start — and, per section 1, the green build tells you
      nothing about whether the variables are right.

---

## 3. Environment variables

- [ ] Add the three required variables from section 0 to **Production**,
      **Preview** and **Development**.
- [ ] `SITE_URL` has no trailing slash. **[verified]** `siteUrl()` strips one
      defensively, but the reason it has to is that `.../` + `/auth/callback`
      produces a double slash that fails Supabase's exact-match Redirect URL
      allowlist and then *silently* falls back to the Site URL with no session
      and no visible error.
- [ ] You will not know the production URL until the first deploy. Deploy once,
      copy the URL, set `SITE_URL` to it, and **redeploy** — `SITE_URL` is read
      at runtime, but a redeploy is the reliable way to be sure it is picked up.

---

## 4. Supabase — two settings that are not in this repo

These live in the Supabase dashboard. Nothing in this codebase can set them and
no test here can catch them being wrong.

- [ ] **[unverified]** Authentication → URL Configuration → **Site URL**: set to
      the Vercel production URL.
- [ ] **[unverified]** Authentication → URL Configuration → **Redirect URLs**:
      add `https://<your-vercel-domain>/auth/callback`.

      **[verified]** from `src/lib/auth/site-url.ts`: the allowlist match is
      exact. A missing or mistyped entry does not error — Supabase falls back to
      the Site URL, the user lands somewhere without a session, and the app has
      no way to report why. This is the single most likely cause of "I clicked
      the email link and nothing happened".

- [ ] Keep `localhost:3000` in the Redirect URLs too, or local development
      breaks.

---

## 5. Deploy, then check these in order

The order matters — each step depends on the one before it working.

- [ ] **The homepage loads.** If this fails the build or platform is wrong, not
      the configuration. **[verified]** the homepage does not touch Supabase, so
      it renders even with the env vars missing entirely — which means *a
      working homepage proves almost nothing*. Keep going.

- [ ] **Log in.** This is the real first test, for two reasons: it is the first
      thing that needs the Supabase vars, and it is the first **server action**.

      **[unverified] — the thing most likely to break.** `next.config.ts` sets
      `experimental.serverActions.allowedOrigins: ["localhost:3000"]`. Next
      checks the `Origin` header against `Host` on every server action as CSRF
      protection. On Vercel those two should match on their own, so this should
      be fine — but the config's own comment says to add the production origin
      once deployed, and every mutating feature in the app is a server action
      (login, register, save notes, add a must-play, remove a blocklist entry).

      If login fails with a server-action or origin error, add the production
      domain to `allowedOrigins` and redeploy. Check this before concluding
      anything else is broken.

- [ ] **`/dashboard` renders** with the DJ's name and their events. This proves
      the session cookie survives the round trip and RLS is reachable.

- [ ] **Open an event.** Both note fields render for the DJ.

- [ ] **Save a note, reload, confirm it persisted.** This is the full write
      path — server action, validation, RLS, upsert — end to end on the
      deployed app.

- [ ] **[verified]** The seeded demo data already exists in the live Supabase
      project, so a deployed app points at real events immediately. No seeding
      step is needed after deploying. Note the project currently holds **54
      events**, most of them debris from earlier test runs; worth cleaning
      before a grader looks.

---

## 6. The Spotify redirect URI — at deployment time, not before

Plan C's Spotify work does **not** need a deployed URL: the authorization-code
flow is registered against a `127.0.0.1` loopback redirect for local
development, and that is enough to build and demonstrate the whole flow.

What follows is therefore a *deployment* step, not a plan C step. It is recorded
here because it is the one people discover only *after* it fails, and it fails
somewhere no test in this repo can reach.

The production redirect URI must be registered in **two** places and they must
match exactly:

1. The **Spotify developer dashboard** → your app → Redirect URIs →
   `https://<your-vercel-domain>/api/spotify/callback`
2. `SPOTIFY_REDIRECT_URI` in Vercel, set to that same string

If they differ by so much as a trailing slash, Spotify rejects the authorisation
at **its** end with `INVALID_CLIENT: Invalid redirect URI` before the user ever
returns to the app. Nothing in this codebase runs, so no test here catches it,
and the app cannot report a useful error.

---

## Local run, for completeness

```bash
npm install
cp .env.example .env.local     # then fill in the values
npm run dev                    # http://localhost:3000
```

`SITE_URL=http://localhost:3000` locally. `npm run seed:demo` populates demo
events for the account in `SEED_DJ_*`.

To check a migration before pushing it, `npm run db:replica` applies every
migration in `supabase/migrations/` to a throwaway local Postgres — see that
script's header for why that is not the same thing as `supabase db lint`.
