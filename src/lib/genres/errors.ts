export type GenreErrorKind =
  | 'unavailable' // 5xx, MusicBrainz 503, Last.fm error != 6, malformed JSON
  | 'rate_limited' // 429
  | 'network'; // fetch itself threw

export class GenreError extends Error {
  constructor(
    readonly kind: GenreErrorKind,
    /** Short, safe context: 'lastfm 503', 'musicbrainz timeout'. NEVER a body,
     *  never a URL -- the Last.fm key is a query parameter. */
    message: string,
  ) {
    super(message);
    this.name = 'GenreError';
  }
}
