/* ---------------------------------------------------------------------------
   Our Spotify shapes, not Spotify's raw ones.

   No `import 'server-only'`: the pickers are Client Components and import these
   types. Same reason detailTypes.ts exists separately from detailDal.ts.

   Deliberately minimal. Artist objects in a development-mode app carry only
   external_urls, href, id, images, name, type and uri -- no genres, no
   popularity, no followers (design §2.3, verified live). Anything not listed
   here is not available to this app.
   --------------------------------------------------------------------------- */

export interface SpotifyTrack {
  id: string;
  name: string;
  artistNames: string[];
  artistIds: string[];
  albumName: string;
  artworkUrl: string | null;
  durationMs: number;
  explicit: boolean;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  artworkUrl: string | null;
}

export type SpotifySearchType = 'track' | 'artist';
