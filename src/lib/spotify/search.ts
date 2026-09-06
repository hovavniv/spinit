import 'server-only';

import { spotifyFetch } from './client';
import { appToken } from './appToken';
import { pickArtwork, type RawImage } from './images';
import type { SpotifyTrack, SpotifyArtist } from './types';

/**
 * `limit=10`. The design asserts this is the API maximum since February 2026;
 * that specific claim is UNVERIFIED -- the live checks covered artist object
 * fields, not the search limit -- and task 6 settles it with one curl. The
 * picker renders six (design §4.3); we ask for ten so a result that fails
 * validation can be dropped without shortening the list.
 *
 * `market` is passed so results are playable where the wedding is.
 */
const LIMIT = 10;
const MARKET = 'IL';

interface RawArtistRef {
  id: string;
  name: string;
}

interface RawTrack {
  id: string;
  name: string;
  duration_ms: number;
  explicit: boolean;
  artists: RawArtistRef[];
  album: { name: string; images: RawImage[] };
}

interface RawArtist {
  id: string;
  name: string;
  images?: RawImage[];
}

function toTrack(raw: RawTrack): SpotifyTrack {
  return {
    id: raw.id,
    name: raw.name,
    artistNames: raw.artists.map((a) => a.name),
    artistIds: raw.artists.map((a) => a.id),
    albumName: raw.album.name,
    artworkUrl: pickArtwork(raw.album.images),
    durationMs: raw.duration_ms,
    explicit: raw.explicit,
  };
}

function toArtist(raw: RawArtist): SpotifyArtist {
  return {
    id: raw.id,
    name: raw.name,
    artworkUrl: pickArtwork(raw.images),
  };
}

export async function searchTracks(q: string): Promise<SpotifyTrack[]> {
  const token = await appToken();
  const json = await spotifyFetch<{ tracks?: { items?: RawTrack[] } }>(
    `/search?q=${encodeURIComponent(q)}&type=track&limit=${LIMIT}&market=${MARKET}`,
    token,
  );
  return (json.tracks?.items ?? []).map(toTrack);
}

export async function searchArtists(q: string): Promise<SpotifyArtist[]> {
  const token = await appToken();
  const json = await spotifyFetch<{ artists?: { items?: RawArtist[] } }>(
    `/search?q=${encodeURIComponent(q)}&type=artist&limit=${LIMIT}&market=${MARKET}`,
    token,
  );
  return (json.artists?.items ?? []).map(toArtist);
}
