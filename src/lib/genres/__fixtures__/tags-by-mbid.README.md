# `tags-by-mbid.jsonl`

12 artists, each `{ name, tags: [{ name, count }] }` shaped like Last.fm's
`artist.gettoptags` **looked-up-by-MBID** response — the production path
(`topTagsByMbid` in `lastfm.ts`), used once `mbidForSpotifyArtist` has
resolved a real MusicBrainz id.

This is a real harvest, taken live on 2026-09-02, using this project's own
`LASTFM_API_KEY`. Required by the original plan (line 895) and the
Definition of Done ("both fixtures committed"), but never actually created —
`tags-by-name.jsonl` (the fallback-rung fixture) shipped alone. That gap
meant the only real harvested data in this slice covered the by-name
fallback, not the primary by-MBID rung — the same class of risk that let an
invented fixture hide the bug that broke `mbidForSpotifyArtist` for every
artist earlier in this slice (see `musicbrainz.ts`'s header comment and the
ledger).

Harvest method, two steps per artist:

1. Resolve a real MBID. Three (`Ariana Grande`, `Olivia Rodrigo`,
   `Cynthia Erivo`) were already confirmed live earlier in this slice via
   MusicBrainz's `/ws/2/url` lookup. The other nine were resolved via
   MusicBrainz's `/ws/2/artist/?query=...` search, each verified against the
   real response rather than trusted from memory.
2. Query Last.fm's `artist.gettoptags?mbid=<mbid>` for that MBID, coercing
   `count` to `Number` (Last.fm sends it as a string on the wire, matching
   what `lastfm.ts` hands to `filterTags` in production).

**One real find worth recording, not smoothed over:** the first attempt to
resolve `Omer Adam`'s MBID used a MusicBrainz Lucene query
(`query=artist:Omer Adam`, no phrase quoting) and it matched **Calvin
Harris** — an entirely unrelated Scottish DJ — with a reported relevance
score of 100. A plain, unquoted-field query (`query=Omer Adam`) correctly
resolved the same artist name to `עומר אדם` (Omer Adam's real MusicBrainz
entry, MBID `06dd06a8-5915-4b23-8cd6-d52b74232e6f`) with the same top score.
The `artist:`-prefixed field query is not reliable for a short, two-common-word
name against MusicBrainz's live search index; a plain query is. Every MBID in
this file was independently verified against a real MusicBrainz response
before being used — this is exactly why that check matters, not a
hypothetical.

Unlike `tags-by-name.jsonl`, this fixture carries no deliberate wrong-artist
regression rows — MBID lookup does not have that ambiguity by construction,
which is the whole reason the primary rung resolves by id rather than name.

This is a **frozen fixture**, not re-harvested on every run: real Last.fm tag
counts drift as people tag. If it is ever regenerated, re-verify each name's
MBID against a real MusicBrainz response rather than reusing a name-to-id
mapping from memory or from this file's own history.
