#!/usr/bin/env bash
#
# Apply every migration in supabase/migrations to a THROWAWAY local Postgres,
# in order, and fail loudly on the first error.
#
# WHY THIS EXISTS
# ---------------
# `supabase db lint` inspects the LIVE database, not a file on disk, and
# `supabase db push` is the first thing that ever parses a new migration --
# by which point it is running against the real project, by hand, by a human.
# The Spotify foundation migration reached that push having never been parsed
# by any Postgres server at all. A reviewer caught that and built a scratch
# replica to check it; this script is that recipe, kept, so the next migration
# does not depend on someone thinking of it again.
#
# It is NOT a Supabase emulator. It stubs the parts of Supabase the repo's
# migrations actually reference -- the auth schema, auth.uid(), the
# moddatetime extension, and the three PostgREST roles -- and nothing else.
# That is enough to prove a migration parses, applies in order, and produces
# the grants, policies and constraints it claims. It cannot prove anything
# about PostgREST's own behaviour; for that, use the live project.
#
# USAGE
#   scripts/dev/pg-replica.sh            # apply migrations, report, drop
#   scripts/dev/pg-replica.sh --seed     # also insert live-shaped rows
#   scripts/dev/pg-replica.sh --keep     # leave the database up for poking
#
# REQUIREMENTS
#   A local Postgres accepting connections (`brew install postgresql@17`,
#   `brew services start postgresql@17`). Nothing else -- it never contacts
#   the hosted project and never reads .env.local, so it cannot touch
#   production and needs no credentials.

set -euo pipefail

DB="spinit_replica_$$"
KEEP=0
SEED=0
SEEDED=0
SEEDED_SONGS=0
SEEDED_PARTNERS=0
SEEDED_GENRES=0
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    --seed) SEED=1 ;;
    -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS="$REPO_ROOT/supabase/migrations"

# Drop the scratch database on ANY exit -- success, failure or Ctrl-C. A
# leftover database is how the next run picks up the last run's state, which
# is the same class of bug as a test fixture that assumes what its teardown
# restored.
cleanup() {
  local code=$?
  if [ "$KEEP" -eq 1 ] && [ "$code" -eq 0 ]; then
    echo ""
    echo "  kept: psql -d $DB     (drop with: dropdb $DB)"
  else
    dropdb --if-exists "$DB" 2>/dev/null || true
  fi
  exit $code
}
trap cleanup EXIT INT TERM

if ! pg_isready -q; then
  echo "No local Postgres accepting connections." >&2
  echo "  brew install postgresql@17 && brew services start postgresql@17" >&2
  exit 1
fi

if [ ! -d "$MIGRATIONS" ]; then
  echo "No migrations directory at $MIGRATIONS" >&2
  exit 1
fi

echo "==> creating $DB"
createdb "$DB"

# The Supabase-shaped surface the repo's migrations reference. Deliberately
# minimal: add to this only when a migration fails for want of something.
echo "==> stubbing the supabase surface"
psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
create schema if not exists auth;
create schema if not exists extensions;
create extension if not exists moddatetime schema extensions;
create extension if not exists pgcrypto   schema extensions;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Reads a GUC so a session can "become" a user without minting a real JWT:
--   set request.jwt.claim.sub = '<uuid>'; set role authenticated;
create or replace function auth.uid() returns uuid
  language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then
    create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then
    create role authenticated nologin; end if;
  -- bypassrls mirrors the hosted role. Note it does NOT bypass table
  -- privileges, which is exactly the trap that cost us a grant.
  if not exists (select 1 from pg_roles where rolname='service_role') then
    create role service_role nologin bypassrls; end if;
end $$;

grant usage on schema public, extensions, auth to anon, authenticated, service_role;

-- Reproduce the HOSTED DEFAULT ACL, which is the thing the migrations' revoke
-- blocks exist to undo: a new table in public arrives as Dxtm for all three
-- roles. Without this the hardening looks like a no-op locally and a missing
-- revoke would pass unnoticed.
alter default privileges in schema public
  grant truncate, references, trigger on tables to anon, authenticated, service_role;
SQL

# Seeded MID-RUN, as soon as public.events exists, not at the end. A migration
# that backfills or deletes per-event only exercises that logic against rows
# that already exist when it runs -- seeding afterwards would leave every
# backfill having processed zero rows and looking fine.
seed_if_ready() {
  [ "$SEED" -eq 1 ] || return 0
  [ "$SEEDED" -eq 0 ] || return 0
  # No `2>/dev/null || echo f` here: that would swallow a genuine psql
  # failure (a bad connection, a typo in this query) as "not ready yet" and
  # let the seed silently skip while the script still exits 0. The query
  # itself already returns false gracefully when the table doesn't exist
  # yet -- `to_regclass` never errors on a missing relation -- so nothing
  # legitimate depends on the swallowed branch. Under `set -e`, a failing
  # command substitution here now stops the script, as it should.
  local has_events
  has_events=$(psql -tAq -d "$DB" -c "select to_regclass('public.events') is not null")
  [ "$has_events" = "t" ] || return 0
  psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-4111-8111-111111111111','dj-a@example.com',       now()),
  ('22222222-2222-4222-8222-222222222222','dj-b@example.com',       now()),
  ('33333333-3333-4333-8333-333333333333','partner-c@example.com',  now()),
  ('44444444-4444-4444-8444-444444444444','unconfirmed@example.com', null);

insert into public.events (dj_id, couple_names, venue, event_date, status)
select '11111111-1111-4111-8111-111111111111', 'Couple '||g, 'Venue', '2026-09-01', 'upcoming'
from generate_series(1,53) g;
insert into public.events (dj_id, couple_names, venue, event_date, status)
values ('11111111-1111-4111-8111-111111111111','Priya & Alex','Brookline Barn','2026-09-12','upcoming');
SQL
  SEEDED=1
  echo "    [seeded 4 users, 54 events -- later migrations now run against them]"
}

# Seeded MID-RUN as well, as soon as event_must_play/event_blocklist exist --
# same reasoning as seed_if_ready above, one migration later. The Spotify
# song-id-required migration (20260831180000) DELETES rows with no id; an
# empty table proves nothing about that delete. This mirrors the live mixed
# shape measured right before that migration was authored: some rows already
# carry a real id (post-picker), some do not (written before the picker
# existed), plus one genre entry, which never carries an id and must survive
# untouched. Removed by 20260831180000's own delete once it runs -- there
# was no earlier point in the migration sequence to seed with a real
# spotify_track_id, since the column does not exist until 20260831140000.
seed_song_lists_if_ready() {
  [ "$SEED" -eq 1 ] || return 0
  [ "$SEEDED_SONGS" -eq 0 ] || return 0
  # Same reasoning as seed_if_ready's probe above: no swallowed error, and
  # `table_schema='public'` so a same-named column in another schema can't
  # produce a false positive.
  local has_column
  has_column=$(psql -tAq -d "$DB" -c \
    "select to_regclass('public.event_must_play') is not null
       and exists (select 1 from information_schema.columns
                    where table_schema='public'
                      and table_name='event_must_play'
                      and column_name='spotify_track_id')")
  [ "$has_column" = "t" ] || return 0
  psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
with target as (select id from public.events where couple_names = 'Priya & Alex')
insert into public.event_must_play
  (event_id, segment, title, artist, moment, spotify_track_id, spotify_artist_id)
select id, 'ceremony'::public.event_segment, 'A Thousand Years', 'Christina Perri',
       'Walking down the aisle', '6z5Yh7kOKeLjqIsNdokIpU', null from target
union all
select id, 'ceremony'::public.event_segment, 'Hava Nagila', 'Traditional',
       'Breaking the glass', '7Ihr8qtzuseTCJ7OmpxW5g', null from target
union all
select id, 'reception'::public.event_segment, 'Can''t Help Falling in Love - Remastered', 'Elvis Presley',
       'First dance', '7lCnb68Q8EGlC1Hkd7Nqsv', null from target
union all
select id, 'party'::public.event_segment, 'September', 'Earth, Wind & Fire',
       'Guaranteed dance-floor filler', '2grjqo0Frpf2okIBiifQKs', null from target
union all
-- Written before the picker existed: no id. This is what the delete removes.
select id, 'party'::public.event_segment, 'Fast', 'Demi Lovato', null, null, null from target;

with target as (select id from public.events where couple_names = 'Priya & Alex')
insert into public.event_blocklist (event_id, segment, entry_type, value, spotify_id)
select id, 'party'::public.event_segment, 'artist'::public.blocklist_entry_type,
       'Nickelback', '6deZN1bslXzeGvOLaLMOIF' from target
union all
-- Written before the picker existed: no id. This is what the delete removes.
select id, 'party'::public.event_segment, 'artist'::public.blocklist_entry_type,
       'Demi Lovato', null from target
union all
select id, 'party'::public.event_segment, 'song'::public.blocklist_entry_type,
       'Cha Cha Slide - Radio Edit — DJ Casper', '6DrfHG3wfZ64xIzpzuZxbf' from target
union all
-- A genre entry never carries an id and must survive the delete untouched.
select id, 'party'::public.event_segment, 'genre'::public.blocklist_entry_type,
       'disco', null from target;
SQL
  # The insert above targets a NAME, not an id -- if 'Priya & Alex' ever
  # drifts, the query above still runs cleanly and inserts zero rows. That
  # is a "success" a script reporting "ok" and "[seeded ...]" would hide
  # completely, and a delete migration verified against zero seeded rows
  # proves nothing (the whole reason this function exists). Count what
  # actually landed rather than trusting that the statement didn't error.
  local landed
  landed=$(psql -tAq -d "$DB" -c \
    "select (select count(*) from public.event_must_play emp
              join public.events e on e.id = emp.event_id
             where e.couple_names = 'Priya & Alex')
          + (select count(*) from public.event_blocklist eb
              join public.events e on e.id = eb.event_id
             where e.couple_names = 'Priya & Alex')")
  if [ "$landed" != "9" ]; then
    echo "seed_song_lists_if_ready: expected 9 rows for 'Priya & Alex' (5 must-play + 4 blocklist), found $landed" >&2
    exit 1
  fi
  SEEDED_SONGS=1
  echo "    [seeded mixed-id must-play/blocklist rows for the delete migration to prove itself against]"
}

# Seeded MID-RUN as soon as event_partners exists (20260831090000), which is
# BEFORE 20260901090000_spotify_genre_enrichment.sql runs -- that migration's
# claim_next_artist and enrichment_queue's new write policy both need a real
# event_partners row to exist, via FK, and the pg-replica seed carried none of
# those before this task. One claimed slot (partner-c), one still pending, on
# 'Priya & Alex' -- matching the shape event_partners actually has once a
# couple starts connecting accounts.
seed_partners_if_ready() {
  [ "$SEED" -eq 1 ] || return 0
  [ "$SEEDED_PARTNERS" -eq 0 ] || return 0
  local has_table
  has_table=$(psql -tAq -d "$DB" -c "select to_regclass('public.event_partners') is not null")
  [ "$has_table" = "t" ] || return 0
  psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
with target as (select id from public.events where couple_names = 'Priya & Alex')
insert into public.event_partners (event_id, slot, display_name, invite_email, user_id)
select id, 1, 'Priya', 'partner-c@example.com',
       '33333333-3333-4333-8333-333333333333'::uuid from target
union all
-- Still pending: the DJ sent this invite, nobody has claimed it yet.
select id, 2, 'Alex', 'alex@example.com', null::uuid from target;
SQL
  local landed
  landed=$(psql -tAq -d "$DB" -c \
    "select count(*) from public.event_partners p
      join public.events e on e.id = p.event_id
     where e.couple_names = 'Priya & Alex'")
  if [ "$landed" != "2" ]; then
    echo "seed_partners_if_ready: expected 2 event_partners rows for 'Priya & Alex', found $landed" >&2
    exit 1
  fi
  SEEDED_PARTNERS=1
  echo "    [seeded 2 event_partners rows for 'Priya & Alex' -- one claimed, one pending]"
}

# Seeded MID-RUN once artist_genres.event_id is NOT NULL, i.e. once
# 20260901090000_spotify_genre_enrichment.sql has fully applied (that
# migration's own 2a section makes it NOT NULL only at the end of the rekey --
# probing for the column alone, rather than for it being required, would seed
# between the ADD COLUMN and the DELETE FROM artist_genres a few lines later
# in that same file and have the seed erased before the file even finishes).
# The point mirrors seed_song_lists_if_ready's own reasoning: a seed that
# leaves artist_genres empty, or leaves enrichment_queue with no rows FK'd to
# a real event_partners row, proves nothing about the pkey swap or the new
# write policy -- "exit 0 is as true of a delete that removed the wrong rows
# as one that removed exactly the right ones."
#
# The SAME spotify_artist_id is seeded against TWO DIFFERENT events. Under the
# OLD global pkey (spotify_artist_id alone) the second insert would raise
# 23505; under the new compound pkey (event_id, spotify_artist_id) both rows
# coexist. That is the one fact this seed exists to prove, and the landed-row
# count below would silently pass even if the second insert had been rejected
# and swallowed, so the failed-row seed particularly needs the explicit count.
seed_genre_enrichment_if_ready() {
  [ "$SEED" -eq 1 ] || return 0
  [ "$SEEDED_GENRES" -eq 0 ] || return 0
  local ready
  ready=$(psql -tAq -d "$DB" -c \
    "select exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='artist_genres'
                       and column_name='event_id' and is_nullable='NO')")
  [ "$ready" = "t" ] || return 0
  psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
with pa as (select id from public.events where couple_names = 'Priya & Alex'),
     c1 as (select id from public.events where couple_names = 'Couple 1')
insert into public.artist_genres
  (event_id, spotify_artist_id, artist_name, status, resolved_via, attempts,
   last_attempt_at, fetched_at)
select (select id from pa), '0LcJLqbBmaGUft1e9Mm8HV', 'Ed Sheeran',
       'resolved'::public.enrichment_status, 'mbid'::public.enrichment_route,
       1, now(), now()
union all
-- Same artist id, a DIFFERENT event: proves the pkey is (event_id,
-- spotify_artist_id), not spotify_artist_id alone -- the old global pkey
-- would raise 23505 on this second row.
select (select id from c1), '0LcJLqbBmaGUft1e9Mm8HV', 'Ed Sheeran',
       'pending'::public.enrichment_status, null::public.enrichment_route,
       0, null, null
union all
-- Failed, and backdated past its own backoff window -- inside
-- artist_genres_retry_idx's partial predicate, and what
-- claim_next_artist's backoff clause should treat as claimable again.
select (select id from pa), '3TVXtAsR1Inumwj472S9r4', 'Drake',
       'failed'::public.enrichment_status, null::public.enrichment_route,
       3, now() - interval '1 hour', null;

with partner as (
  select p.id from public.event_partners p
   join public.events e on e.id = p.event_id
  where e.couple_names = 'Priya & Alex' and p.slot = 1
)
insert into public.enrichment_queue (partner_id, artist_id, position, claimed_at, settled_at)
select id, '0LcJLqbBmaGUft1e9Mm8HV', 1, null::timestamptz, now() from partner
union all
select id, '3TVXtAsR1Inumwj472S9r4', 2, null::timestamptz, null::timestamptz from partner
union all
-- Unsettled, unclaimed, no artist_genres row at all: what a fresh
-- claim_next_artist call should pick up first.
select id, '6z5Yh7kOKeLjqIsNdokIpU', 3, null::timestamptz, null::timestamptz from partner;
SQL
  local landed
  landed=$(psql -tAq -d "$DB" -c \
    "select (select count(*) from public.artist_genres)
          + (select count(*) from public.enrichment_queue)")
  if [ "$landed" != "6" ]; then
    echo "seed_genre_enrichment_if_ready: expected 6 rows total (3 artist_genres + 3 enrichment_queue), found $landed" >&2
    exit 1
  fi
  SEEDED_GENRES=1
  echo "    [seeded artist_genres (same artist, two events -- pins the pkey swap) and enrichment_queue rows]"
}

echo "==> applying migrations"
shopt -s nullglob
FILES=("$MIGRATIONS"/*.sql)
if [ ${#FILES[@]} -eq 0 ]; then
  echo "No .sql files in $MIGRATIONS" >&2
  exit 1
fi

# Read from the directory, sorted, rather than a hardcoded list -- a list rots
# the moment someone adds a migration and forgets this file.
for f in $(printf '%s\n' "${FILES[@]}" | sort); do
  name="$(basename "$f")"
  printf '    %-52s' "$name"
  if psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null 2>/tmp/pg-replica-err.$$; then
    echo "ok"
    seed_if_ready
    seed_song_lists_if_ready
    seed_partners_if_ready
    seed_genre_enrichment_if_ready
  else
    echo "FAILED"
    echo ""
    sed 's/^/      /' /tmp/pg-replica-err.$$ >&2
    rm -f /tmp/pg-replica-err.$$
    exit 1
  fi
done
rm -f /tmp/pg-replica-err.$$

# --seed was asked for and never actually ran, for any reason (a probe
# never went true, a migration this depends on stopped existing, etc.) --
# a run that reports success while quietly seeding nothing is worse than a
# run that fails loudly, because everything after it inherits the false
# confidence.
if [ "$SEED" -eq 1 ] && {
  [ "$SEEDED" -eq 0 ] || [ "$SEEDED_SONGS" -eq 0 ] ||
  [ "$SEEDED_PARTNERS" -eq 0 ] || [ "$SEEDED_GENRES" -eq 0 ];
}; then
  echo "--seed was requested but seeding never completed" \
    "(SEEDED=$SEEDED, SEEDED_SONGS=$SEEDED_SONGS," \
    "SEEDED_PARTNERS=$SEEDED_PARTNERS, SEEDED_GENRES=$SEEDED_GENRES)" >&2
  exit 1
fi

echo "==> summary"
psql -tAq -d "$DB" <<'SQL'
select '    tables in public: '||count(*) from pg_tables where schemaname='public';
select '    rls enabled:      '||count(*) from pg_class
 where relnamespace='public'::regnamespace and relkind='r' and relrowsecurity;
select '    policies:         '||count(*) from pg_policies where schemaname='public';
select '    security definer functions with empty search_path: '||count(*)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prosecdef and p.proconfig::text like '%search_path=%';
select '    tables anon can still TRUNCATE: '||count(*)
  from information_schema.role_table_grants
 where grantee='anon' and privilege_type='TRUNCATE';
select '    event_must_play: '||count(*)||' rows, '
       ||count(*) filter (where spotify_track_id is null)||' with no track id'
  from public.event_must_play;
select '    event_blocklist: '||count(*)||' rows, '
       ||count(*) filter (where entry_type in ('artist','song') and spotify_id is null)
       ||' artist/song with no id, '
       ||count(*) filter (where entry_type = 'genre')||' genre'
  from public.event_blocklist;
select '    artist_genres:    '||count(*)||' rows, '
       ||count(distinct spotify_artist_id)||' distinct artist ids -- '
       ||'fewer distinct ids than rows proves the compound (event_id, spotify_artist_id) pkey'
  from public.artist_genres;
select '    enrichment_queue: '||count(*)||' rows, '
       ||count(*) filter (where settled_at is not null)||' settled'
  from public.enrichment_queue;
SQL

echo ""
echo "==> ALL MIGRATIONS APPLIED CLEANLY"
