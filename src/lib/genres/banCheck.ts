import type { EnrichInput, EnrichOutcome } from './enrich';
import type { FacetedTags } from './types';
import { normaliseGenre } from './vocabulary';

/**
 * The DJ's ban-check path (design §2.11a) -- distinct from task 7's bulk,
 * polled, `taste_profiles`-writing sync. This checks ONE suggested artist on
 * demand against the couple's do-not-play genre list, reading/writing
 * `artist_genres` only.
 *
 * SHIPS UNCALLED, DELIBERATELY: the guest suggestion flow this feeds does
 * not exist yet -- it belongs to a future slice, once guests can suggest
 * songs at all. Whichever task wires the DJ screen's "check this
 * suggestion" action constructs the real `BanCheckDeps` object, e.g.
 * `{ readGenres, blockedGenres, enrichArtist: (input) => enrichArtist(input, realEnrichDeps) }`.
 * No policy change is needed to wire it: task 2a's per-event `artist_genres`
 * policy already admits the DJ, which is why that table was scoped per-event
 * rather than per-partner in the first place.
 */
export interface BanCheckDeps {
  readGenres: (eventId: string, artistId: string) => Promise<FacetedTags | null>;
  // Pre-bound by the caller -- genreBanVerdict does not hold an EnrichDeps to
  // pass as a second argument.
  enrichArtist: (input: EnrichInput) => Promise<EnrichOutcome>;
  blockedGenres: (eventId: string) => Promise<string[]>;
}

export async function genreBanVerdict(
  eventId: string,
  artist: { id: string; name: string },
  deps: BanCheckDeps,
): Promise<{ banned: boolean; matchedGenre: string | null; reason: string }> {
  const cached = await deps.readGenres(eventId, artist.id);

  let genres: Record<string, number>;
  if (cached !== null) {
    genres = cached.genres;
  } else {
    const outcome = await deps.enrichArtist({ eventId, artistId: artist.id, name: artist.name });
    if (outcome.status === 'failed') {
      return {
        banned: false,
        matchedGenre: null,
        reason: `could not be checked: ${outcome.reason}`,
      };
    }
    genres = outcome.genres.genres;
  }

  const blocked = await deps.blockedGenres(eventId);
  const normalisedBlocked = new Set(blocked.map((g) => normaliseGenre(g)));

  // Match on the whole normalised key exactly -- `.includes()` would let
  // `rap` match `trap`, `pop` match `k-pop`, `house` match `deep house`.
  const matched = Object.keys(genres).find((key) => normalisedBlocked.has(key));

  if (matched !== undefined) {
    return {
      banned: true,
      matchedGenre: matched,
      reason: `${artist.name} matches blocked genre "${matched}"`,
    };
  }

  const topGenres = Object.keys(genres);
  const reason = topGenres.length > 0
    ? `${artist.name}'s genres (${topGenres.join(', ')}) are not on the do-not-play list`
    : `${artist.name} has no known genres`;

  return { banned: false, matchedGenre: null, reason };
}
