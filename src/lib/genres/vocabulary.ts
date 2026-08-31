/* ---------------------------------------------------------------------------
   The curated vocabulary (design §2.3). TWO JOBS, one file:
     1. the source for GenrePicker -- Spotify has no genre search
     2. (Plan C) the FILTER that turns Last.fm's raw tags into facets.
        Unfiltered, live data reads "hebrew, pop, hairy chest".
   --------------------------------------------------------------------------- */

export const GENRES = [
  'mizrahi', 'israeli pop', 'israeli rock', 'israeli hip-hop', 'hafla', 'hora',
  'pop', 'dance-pop', 'synth-pop', 'rock', 'classic rock', 'soft rock', 'hard rock',
  'indie', 'indie pop', 'indie rock', 'alternative', 'grunge', 'rnb', 'soul', 'funk',
  'disco', 'hip-hop', 'rap', 'trap', 'reggae', 'roots reggae', 'dancehall', 'reggaeton',
  'latin', 'salsa', 'bachata', 'merengue', 'cumbia', 'flamenco', 'tango',
  'electronic', 'house', 'deep house', 'techno', 'trance', 'edm', 'dubstep',
  'drum and bass', 'jazz', 'swing', 'big band', 'blues', 'country', 'bluegrass',
  'folk', 'metal', 'punk', 'ska', 'new wave', 'classical', 'opera', 'k-pop', 'j-pop',
  'rock n roll', 'gospel', 'afrobeat', 'afrobeats', 'highlife', 'klezmer',
  'balkan brass', 'gypsy jazz', 'ambient', 'lo-fi', 'world',
] as const;

/** Facets, NOT genres. Stored separately; never rendered beside a genre. */
export const ORIGINS = [
  'israeli', 'american', 'british', 'french', 'greek', 'balkan', 'arabic',
  'turkish', 'spanish', 'italian', 'brazilian', 'nigerian', 'korean', 'japanese',
  'swedish',
] as const;

export const ERAS = ['60s', '70s', '80s', '90s', '00s'] as const;

export const ALIASES: Record<string, string> = {
  israel: 'israeli', hebrew: 'israeli', jewish: 'israeli', isr: 'israeli',
  'r&b': 'rnb', 'rhythm and blues': 'rnb', 'r and b': 'rnb',
  'hip hop': 'hip-hop', 'israeli hip hop': 'israeli hip-hop',
  'dance pop': 'dance-pop', mizrachi: 'mizrahi',
  electronica: 'electronic', 'rock and roll': 'rock n roll',
};

export type Facet = 'genre' | 'origin' | 'era';

export function normaliseGenre(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  return ALIASES[key] ?? key;
}

/** Which bucket a normalised token belongs to, or null if it is noise. */
export function facetOf(token: string): Facet | null {
  if ((GENRES as readonly string[]).includes(token)) return 'genre';
  if ((ORIGINS as readonly string[]).includes(token)) return 'origin';
  if ((ERAS as readonly string[]).includes(token)) return 'era';
  return null;
}
