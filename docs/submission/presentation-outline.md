# Presentation outline

Deliverable 10, as a structure rather than slides. 10–15 minutes, which is roughly **14
slides at a minute each** — fewer than feels right, so the discipline is choosing what to
leave out.

The brief requires: what the product is, the problem, its users, business value, how it's
built, architecture, database, core flows, tests, scale, security, and what you'd improve.
All twelve are below. What follows the outline is the part that matters more — the two or
three things worth spending your best minutes on.

---

## The arc

Not a feature tour. A tour makes every part sound equally considered, and yours aren't —
some decisions have real reasoning behind them and some are ordinary. Spend the time where
the thinking was.

**Problem → who pays → the one hard part → how it's built → how you know it works → what's
left.**

---

## Slide by slide

### 1. Title
Spinit. One line: *"The DJ's screen tells them what to play next — and why."*

### 2. The problem (1 min)
The music at a wedding is decided three times and the three decisions disagree: the couple
tells the DJ months before, guests want things during, and the DJ decides in the moment under
pressure and in the dark.

Name the failures concretely — the banned song played, the first dance nobody wrote down, the
same artist three times in twenty minutes. **Do not** describe the software yet.

### 3. Why existing answers don't work (1 min)
A spreadsheet has no structure and can't be queried mid-event. A request app collects
suggestions and stops — the DJ still gets an undifferentiated pile, and the couple's
preferences aren't in the system at all.

> The gap isn't intake. It's that nothing connects what the couple wants, what the guests
> want, and what the DJ should therefore play next.

### 4. Users, and who pays (1 min)
Three roles: DJ, couple, guests. One table, three rows — what each needs, and what each must
never reach.

Then the commercial point in one line: **the DJ is the customer, the couple is the
beneficiary, the guests are the volume.** A DJ buys a tool that makes them better at what
they're already paid for, and buys it 40–80 times a year.

### 5. The differentiator (1–2 min) — *spend time here*
A deterministic ranking function that **returns why**:

> **rank 3** — 12 people asked for it, but this artist played 2 songs ago

Two payoffs, and say both: a DJ won't trust a recommendation without a reason at 11pm; and
it's a pure function from state to a ranked, annotated list, so it's the most testable thing
in the project.

**Be honest that it's designed and not built.** That's a stronger position than implying
otherwise, and it sets up slide 13.

### 6. What that forces everywhere else (1 min) — *the best architecture slide you have*
The engine can only reason about **identity**, never strings. "This artist repeated two songs
ago" needs an artist id. "Already suggested" needs a track id, not a fuzzy match between
`Dancing Queen` and `Dancing Queen - Remastered 2010`.

**So every song is picked from Spotify, never typed** — including on the DJ's own planning
screen, where a text box would have been easier for everyone.

This is the slide that shows a decision propagating. Most projects can't show one.

### 7. Architecture (1 min)
Next.js App Router, Supabase Postgres, Vercel. Three decisions, one line each:

- **Authorization lives in the database** — RLS, not application code
- **Server Components by default** — the browser never holds a privileged client
- **Per-item writes** — each add is one row, immediately

### 8. The database (1 min)
The diagram, then **one** decision defended properly. Pick the notes split:

> The couple must read the event. RLS is per-row and can't restrict columns. So a private
> note living on `events` would be readable by anyone who can read the row — and both note
> kinds moved to their own tables. `events` now has no column a partner may not see.

That's a real constraint producing a real design change. Better than listing twelve tables.

### 9. Security (1–2 min) — *your second-best slide*
Lead with the pattern, not the practices:

> A control closed on one surface and left open on the adjacent one. **Eight times.**

Give one concrete instance: `UPDATE` was column-scoped so a DJ couldn't take over a partner
row — and `INSERT` stayed table-level, so they could create one instead.

Then the fix that generalises: **assertions written per capability, not per verb.** One query
enumerating both `role_table_grants` and `role_routine_grants` catches what two verb-shaped
tests missed.

### 10. Testing (1–2 min) — *the anecdote to lead with*

> **An assertion nobody has seen fail is a comment.**

Two real examples: a test asserting a component wasn't a form wrapper, where the component
*can't take children* — it could never fail. And a component whose most load-bearing output
had **no assertion at all** while the suite was green.

So every strengthened assertion is proven by mutation: make the bug, watch the named test
fail, revert.

### 11. Scale (1 min)
Not "it scales." The shape:

> Two load profiles, almost opposite. One DJ planning over weeks; two hundred phones on one
> venue's wifi in the same three minutes.

Then the constraint that shaped the design: **Spotify caps this app at five users, forever.**
The architecture confines it — that cap applies to user-scoped tokens only, so search runs on
an app token and *the one thing that must scale is the one thing Spotify doesn't limit.*

Say plainly that no load test was run.

### 12. What went wrong, and what caught it (1–2 min) — **your strongest slide**
See below. Do not cut this one.

### 13. What I'd do with more time (1 min)
Four, in order: the decision engine; the guest flow; Google sign-in; end-to-end tests.

Say which you'd do **first and why** — the engine, because everything upstream exists to
serve it.

### 14. Close
Back to the one line. *"A queue tells you what's next. This tells you why."*

---

## The three minutes worth planning properly

Everything above is competent. These are what an examiner will remember.

### The reversal (slide 12)

The design introduced a service-role key — a credential that bypasses row-level security —
to protect a globally shared genre cache. It survived **four adversarial reviews**.

Then a question: *"is it a must, or is it what you preferred?"*

Those are different claims and the design had presented one as the other. The argument was
that a global cache pays its enrichment cost *once across the whole project*. True of a
product with many couples. **This product is capped at five Spotify users.** There was almost
no sharing to protect — the architecture had been priced for a user base the API doesn't
permit.

Scoping the cache per event and narrowing one route closed both holes with **no elevated
credential at all.**

> Four reviews validated the mechanism. **None tested the premise.** Nothing in the process
> asked whether the argument applied to *this* product.

That is the most transferable thing the project produced, and it isn't in the code.

### Three assumptions the documentation got wrong

Verified against the live API, not read:

- **Spotify serves this app no genre data at all** — the field is absent from every response
  shape it can reach. The design rested on it for three revisions.
- **Querying Last.fm by artist name returns the wrong artist** ~5% of the time — an Israeli
  rapper came back as *death industrial*, and those are real genre words that pass any
  filter. Only an id-based lookup catches it.
- **`/me/top/artists` lags by hours to days.** Listening more and refreshing changes nothing.

Each would have shipped as a silent bug. The lesson: **the API's documentation is a claim,
not evidence.**

### One failure that wore the wrong label

A test failed for a day, reported as the mailer quota. It was *also* failing because the
address used a reserved domain the provider rejects — two distinct causes under one label.

> An explanation that fits the first observation stops the investigation.

It was caught only because someone noticed the **error text had changed** and said so instead
of re-reporting the conclusion.

---

## Presenting it

**Lead with the problem, not the stack.** Nobody's opinion of the architecture changes based
on the framework.

**Name one thing that's designed and not built, early.** It buys credibility for everything
you do claim, and stops a question from becoming a gotcha.

**Have the numbers ready but not on slides:** twelve tables, ~440 tests, eight migrations,
four adversarial reviews, roughly sixty findings, two of three slices merged. Say them when
asked.

**Prepare for the obvious hard question:** *"how much of this did you write?"* The honest
answer is strong — the code was AI-assisted, the decisions are defensible, and the reversal
in slide 12 happened because **you** asked a question four automated reviews hadn't. That's
the answer. It's better than a denial and better than a deflection.
