# Product specification

Deliverable 3. The problem, who has it, who pays, what the product must do, and the flows
that matter.

---

## 1. The problem

At a wedding, the music is decided three times and the three decisions disagree.

**Months before**, the couple tells the DJ what they want — usually in one meeting, verbally,
half-remembered on both sides. It lands in a note on a phone or a spreadsheet nobody opens
again.

**During the reception**, guests want to hear things. They tell the DJ by walking up to the
booth mid-set, which interrupts them, or by telling a bridesmaid, who forgets. The requests
that reach the DJ are the ones from the guests most willing to interrupt — which is not the
same as the ones the room wants.

**In the moment**, the DJ decides. They are balancing what the couple asked for, what the
room is doing, who has just walked over, and whether they have played too much of one artist
— under time pressure, from memory, in the dark.

The result is a familiar set of small failures: the song the couple explicitly banned gets
played; the must-play at the wrong moment; the same artist three times in twenty minutes; and
a first dance the couple mentioned once in March and nobody wrote down.

**None of these is a hard problem. They are all a memory-and-coordination problem**, and
that is what software is for.

### What's wrong with how it's solved today

- **A shared spreadsheet** is where the couple's preferences go to die. It has no structure,
  so "no country music" and "Hava Nagila for the chuppah" sit in the same column, and the DJ
  cannot query it during the event.
- **Request slips or a hashtag** collect suggestions but produce a pile, not an ordering.
  The DJ still has to read all of it and decide, which is the actual work.
- **Existing request apps** let guests submit songs to a queue. They solve intake and stop
  there — the DJ still gets an undifferentiated list, and the couple's preferences are not in
  the system at all, so a guest can request the ex-boyfriend's song and nothing knows.

The gap is not intake. It is that **nothing connects what the couple wants, what the guests
want, and what the DJ should therefore play next.**

---

## 2. Users

Three roles, genuinely different, sharing one system.

### 2.1 The DJ — the operator, and the customer

A working wedding DJ, typically self-employed or in a small company, running one event a
night. Technically competent but not technical; running the event from a laptop that is also
playing the music.

**What they need:** the couple's requirements in a form they can act on at 11pm; guest
requests filtered and ranked rather than piled; and — this is the part that matters — a
reason for the ranking they can see in a second, because a suggestion they cannot justify is
a suggestion they will not trust.

**What they must never have:** a screen that requires reading. If it needs more than a
glance, it will not be used while the floor is full.

### 2.2 The couple — the hosts

Two people, planning a wedding, deeply invested in the music and not in software. They meet
the DJ perhaps twice.

**What they need:** to say what they want *once*, have it recorded exactly, and edit it later
when they change their minds — which they will. To hear the songs they asked for. To not hear
the ones they banned.

**What they will not do:** fill in a long form. Anything asking them to type out fifty songs
will be abandoned, which is why the product reads their streaming library instead of asking.

### 2.3 The guests

Fifty to three hundred people, average age anywhere, holding a phone with bad wifi, standing
up, mildly drunk, for about ninety seconds of attention.

**What they need:** to suggest a song in under thirty seconds, with no app install, no
account, and no password. To see that it registered.

**What they must not be able to do:** flood the queue, suggest for an event they were not
invited to, or override the couple.

---

## 3. Who pays, and why

**The DJ is the customer.** The couple is the beneficiary; the guests are the volume.

That is the whole commercial logic and it drives the design. A DJ buys a tool that makes
them look better at the thing they are already paid for — and the couple's taste report is
something they can show in a *sales* meeting, before the booking, as evidence they take the
music seriously. The product's first value is delivered before the event exists.

The business shape that follows: per-DJ subscription, or per-event fee, sold to someone who
does 40–80 weddings a year and whose competition is another DJ with a spreadsheet.

**Why not sell to the couple?** They buy once, in their life, under time pressure, and they
are already spending on eleven other vendors. The DJ buys repeatedly, evaluates on whether it
makes their night easier, and can tell fifty other DJs.

---

## 4. Business goals

1. **A DJ can walk into an event knowing what the couple wants**, structured well enough to
   act on — not a paragraph of notes.
2. **Guest requests arrive ranked, with a reason.** The DJ still chooses; the product does
   the reading.
3. **The couple feels heard**, which is what they are actually buying from their DJ.
4. **The recap is a keepsake** — every song played, in order, with who suggested it. Zero
   marginal cost, and it is the thing a couple shows their friends, which is the DJ's next
   booking.

---

## 5. Required capabilities

### 5.1 Before the event

- A DJ registers, logs in, and creates an event: couple's names, date, venue, guest count.
- The DJ invites both partners by email. Each partner gets their own account.
- Each partner **connects their own streaming profile**, producing a taste report the DJ sees
  before the first planning meeting.
- Both the DJ and the couple maintain, on the same screen:
  - **must-play** songs, per segment (ceremony / reception / party), optionally tagged with a
    moment ("first dance", "cake")
  - **do-not-play** entries, by artist, by song, or by genre
  - **ceremony moments** — named slots such as walking down the aisle and breaking the glass
- The DJ keeps **private planning notes** the couple cannot see, alongside **shared notes**
  both sides can.

Every song is chosen from Spotify search rather than typed, so the system holds an identity
rather than a string — see §7.

### 5.2 During the event

- Guests scan a **QR code** and reach a **no-login** screen for that one event.
- A guest may suggest **at most 3 songs**; voting is unlimited.
- Suggesting a song that already exists **surfaces the existing suggestion and offers a vote
  instead** — visible in the search results, before submitting, not as a rejection after.
- Heavily-voted songs surface to the DJ as **hot requests**.
- The DJ sees live analysis of suggestions against the couple's taste and both lists.
- **The DJ approves everything that gets played.** The product never plays anything.

### 5.3 After the event

- The couple receives a playlist of every song played, in order, with who suggested each.

---

## 6. Core flows

### 6.1 DJ creates an event and invites the couple

```
register / log in
   → dashboard
   → new event: names, date, venue, guest count
   → invite: both partners' emails
   → each partner receives a private link
```

### 6.2 A partner connects their music

```
open invite → create account → connect Spotify
   → we read their top artists
   → artist panels render immediately
   → genre analysis fills in behind them (a minute or two)
   → the DJ sees a combined report: shared ground, each partner's own, genres to avoid
```

The combined report is the interesting artifact. Two individual profiles are two lists; the
*overlap and the divergence* is what a DJ actually needs before a planning meeting — where
they agree, and where the argument will be.

### 6.3 The planning meeting

DJ and couple sit with the same screen. The taste report's genres appear as one-tap chips
that write straight into must-play or do-not-play, so the report is not a chart to look at —
it is the thing that fills in the lists.

### 6.4 A guest suggests a song

```
scan QR → event screen, no login
   → type a song name
   → pick from Spotify results
   → already suggested? the row shows the vote count and offers Vote
   → otherwise: suggest (up to 3)
```

### 6.5 The DJ decides what to play next

The differentiating flow. The DJ sees a **ranked list with a reason per row**, not a queue.

### 6.6 After the last dance

The couple gets the recap: every song, in order, with attribution.

---

## 7. The differentiating piece: a decision engine that explains itself

Everything above is a form. This is the product.

The next song is chosen by crossing: the do-not-play list; must-plays not yet played; the
number of requesters; the current event phase; how much time is left in that phase; the
artist-repeat limit; and what has already been played.

It is a **deterministic ranking function that also returns why**:

> **rank 3** — 12 people asked for it, but this artist played 2 songs ago

Two payoffs, and they are the reason the design is shaped this way:

**For the DJ**, a recommendation without a reason is one they will not trust at 11pm. A
recommendation with one is a decision they can make in a second, which is all the time they
have.

**For the engineering**, it is real business logic with a testable contract — a pure function
from state to a ranked, annotated list. No network, no database, no mocking. It is where the
project's most valuable tests live.

### Why this forces a design decision elsewhere

The engine can only reason about identity, never about strings. "This artist repeated two
songs ago" needs an artist id. "Already suggested" needs a track id, not a fuzzy match
between `Dancing Queen` and `Dancing Queen - Remastered 2010`. "The couple banned this"
needs the ban and the candidate to be one value, not two spellings.

**That is why every song in the system is picked from search rather than typed** — including
on the DJ's own planning screen, where a free-text box would have been easier for everyone
involved. The cost is that a song not on Spotify cannot be entered at all; the benefit is
that everything in the system is something the engine can reason about.

---

## 8. Scope

### Built

DJ authentication; dashboard with upcoming and past events; the event page with ceremony
slots, must-play, do-not-play and notes; the event recap. Row-level authorization throughout.

### Designed, in progress

Spotify connect and the taste report; song pickers on every field; partner accounts sharing
the event page.

### Designed, not built

The decision engine; the guest-facing screen and QR entry; the live event screen.

### Deliberately out of scope

- **Playing music.** Spinit tells the DJ what to play. Their existing software plays it.
- **Apple Music and YouTube Music.** The interface is provider-shaped so a second provider is
  additive; only Spotify is built.
- **Payment.** The business model is described, not implemented.
- **Multi-DJ companies.** One DJ, one account.

---

## 9. What would make this a real product

1. **The guest flow.** Everything above assumes it; it is the largest unbuilt piece and the
   one with the most users.
2. **Google sign-in.** Password auth is the only method today, which is both a friction and a
   compliance problem (see the security doc).
3. **A DJ's own library.** Every DJ has songs they always play. The product should learn them.
4. **Post-event analytics across events** — which songs actually fill a floor, aggregated
   over a career. That is the thing a DJ would pay more for, and it needs the recap data the
   product already collects.
