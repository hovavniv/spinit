# `tags-by-name.jsonl`

55 artists, each `{ name, tags: [{ name, count }] }` shaped like Last.fm's
`artist.gettoptags` **looked-up-by-name** response.

This is invented data (no live network access was available while writing
this fixture), not a real harvest — but it deliberately reproduces the
specific failure mode `filter.ts`'s tests need to exercise: Last.fm's
by-name lookup is ambiguous across artists who share a name, and can return
a completely unrelated artist's tags. The **last three rows are wrong on
purpose** and MUST stay wrong:

| name         | tags in this fixture                                         | why they're wrong |
|--------------|---------------------------------------------------------------|--------------------|
| `Subliminal` | power electronics, industrial, noise, death industrial         | the real Subliminal is an Israeli hip-hop artist; by-MBID lookup returns `israeli/hip-hop/rap` instead |
| `Tuna`       | Albanian, Macedonian                                           | the real Tuna is an Israeli rock band; by-MBID lookup returns `rap/rock/alternative` instead |
| `Rita`       | j-pop, japanese, anime, doujin                                 | the real Rita is an Israeli/Persian pop singer, not a j-pop act |

These three rows are the regression evidence for design §2.10 (by-name
lookup returning the wrong artist's tags). **Do not "fix" these three rows**
to look more plausible, and do not read this file as ground truth about what
genre any of these three artists actually are — it is the wrong-artist
answer, kept on purpose so a future reader doesn't quietly relearn it as
correct. Every other row in the file is unrelated fabricated data used only
to give `filterTags` a large, diverse, realistic-shaped input to bucket.

This is a frozen fixture, never re-harvested: real Last.fm tag counts drift
as people tag, so a test that hit the network on every run would be flaky
by construction. If it is ever regenerated, keep it at exactly 55 rows (a
`filter.test.ts` assertion pins that count) and keep the three wrong rows
above with exactly the tags shown.
