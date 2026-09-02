# `tags-by-name.jsonl`

55 artists, each `{ name, tags: [{ name, count }] }` shaped like Last.fm's
`artist.gettoptags` **looked-up-by-name** response.

This is a real harvest, taken live on 2026-09-02 against Last.fm's
`artist.gettoptags` endpoint, queried **by artist name** (not by MBID), using
this project's own `LASTFM_API_KEY`. It replaces an earlier version of this
file that was invented (fabricated by hand, no live network access at the
time) despite claiming otherwise — a documented defect in the original C2
plan. `count` values are coerced to `Number`, matching what
`src/lib/genres/lastfm.ts` hands to `filterTags` in production (Last.fm sends
`count` as a string on the wire). One artist (`Static and Ben El`) returned no
tags at all — a genuine "not found"/no-data outcome, kept as `tags: []` rather
than dropped, since that is a real result the pipeline must handle.

Three rows are deliberate **regression evidence for design §2.10** (by-name
lookup can return a completely unrelated artist's tags, which is why the real
pipeline resolves by MBID instead of by name). All three were re-verified
against live Last.fm data for this harvest, and the ambiguity premise held for
all three — the actual returned tags are shaped like a wrong, unrelated
artist, not the real Israeli artist:

| name         | real Israeli artist          | actual harvested tags (by name)                                                   | shape |
|--------------|-------------------------------|-------------------------------------------------------------------------------------|-------|
| `Subliminal` | Israeli hip-hop artist         | power electronics (100), industrial (59), noise (35), galakthorroe (18), death industrial (5), plus a few low-count `israeli`/`rap`/`hip-hop` tags | dominated by an unrelated industrial/noise act; the correct `israeli hip-hop` signal is present but swamped |
| `Tuna`       | Israeli rock band               | Israel (100), Albanian (100), Macedonian (37), pop (37), hebrew (8), israeli (8), plus stray unrelated tags | tied top tags split between an Albanian/Macedonian artist and genuine Israeli tags — ambiguous exactly as predicted |
| `Rita`       | Israeli/Persian pop singer     | j-pop (100), female vocalists (81), japanese (51), game (35), doujin (14), anime (6), doujin ongaku (4) | dominated by a Japanese pop/doujin act; no Israeli signal at all |

By-MBID lookup (the production path, `topTagsByMbid` in `lastfm.ts`) avoids
this by construction — it is not re-verified here since this fixture exists
specifically to exercise the by-name failure mode `filter.ts`'s consumers
must tolerate.

This is a **frozen fixture**, not re-harvested on every run: real Last.fm tag
counts drift as people tag, so a test that hit the network on every run would
be flaky by construction. If it is ever regenerated, keep it at exactly 55
rows (a `filter.test.ts` assertion pins that count) and keep `Subliminal`,
`Tuna`, and `Rita` in the list — their wrong-artist shape is real, current
Last.fm data, not something to preserve as a fabricated constant, but the
three names still need to be present for the regression to mean anything.
