import { combineTaste } from '@/lib/spotify/taste';
import type { ScoredArtist, TasteProfile as TasteProfileType, WeightedGenre } from '@/lib/spotify/tasteTypes';
import styles from './TasteProfile.module.css';

interface PartnerTaste {
  name: string;
  profile: TasteProfileType | null;
}

interface EnrichmentProgress {
  settled: number;
  total: number;
}

interface TasteProfileProps {
  partner1: PartnerTaste;
  partner2: PartnerTaste;
  /** Per-artist genre-count maps, keyed by spotify_artist_id (design §5.1,
   *  plan task 8b/9). Threaded straight into `combineTaste`'s third
   *  argument -- see that function for how genre weights are derived. */
  genresByArtistId: Record<string, Record<string, number>>;
  /** Counts over `enrichment_queue` for this couple (design §2.10/2.11),
   *  never over the artist list itself -- see queueCounts. */
  progress: EnrichmentProgress;
}

const TOP_GENRE_BARS = 4;

function GenreBars({ genres }: { genres: WeightedGenre[] }) {
  return (
    <ul className={styles.artistList}>
      {genres.slice(0, TOP_GENRE_BARS).map((genre) => (
        <li key={genre.name} className={styles.artist} data-testid="genre-bar">
          {genre.name}
        </li>
      ))}
    </ul>
  );
}

function AvoidGenres({ genres }: { genres: string[] }) {
  if (genres.length === 0) return null;
  return (
    <div data-testid="avoid-genres">
      <h4 className={styles.subheading}>Probably steer clear of</h4>
      <ul className={styles.artistList}>
        {genres.map((genre) => (
          <li key={genre} className={styles.artist} data-testid="avoid-genre">
            {genre}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The three enrichment states (design §2.10/§2.11, plan task 9):
 *
 *  - `total === 0`: nobody has connected yet -- render nothing genre-shaped,
 *    not even "still analysing", which would promise progress on work that
 *    has not started.
 *  - `settled < total`: the queue is still draining -- "still analysing"
 *    plus a real count, never an indefinite spinner.
 *  - `settled === total` (and `total > 0`): the queue is drained -- render
 *    the genre bars if `combineTaste` found anything, or say plainly that
 *    it didn't. `settled === total` is trivially true at `0 === 0`, which is
 *    why this branch is only reached once `total > 0` is also checked.
 */
function GenrePanels({
  progress,
  combined,
}: {
  progress: EnrichmentProgress;
  combined: ReturnType<typeof combineTaste>;
}) {
  if (progress.total === 0) return null;

  if (progress.settled < progress.total) {
    return (
      <div className={styles.waiting}>
        <p>Still analysing — genres take a few minutes.</p>
        <p>
          {progress.settled} of {progress.total}
        </p>
      </div>
    );
  }

  return (
    <>
      <div data-testid="top-genres">
        <h4 className={styles.subheading}>Top genres</h4>
        {combined.topGenres.length === 0 ? (
          <p className={styles.matchCopy}>We couldn&apos;t work out any shared genres yet.</p>
        ) : (
          <GenreBars genres={combined.topGenres} />
        )}
      </div>
      <AvoidGenres genres={combined.avoidGenres} />
    </>
  );
}

function ArtistList({ artists }: { artists: ScoredArtist[] }) {
  if (artists.length === 0) {
    return <p className={styles.empty}>None yet.</p>;
  }
  return (
    <ul className={styles.artistList}>
      {artists.map((artist) => (
        <li key={artist.id} className={styles.artist}>
          {artist.name}
        </li>
      ))}
    </ul>
  );
}

/**
 * The couple's shared-taste report (design §6.1, C1 artist panels + C2 genre
 * panels, plan task 9).
 *
 * Pure presentational: both profiles are already-computed props, and
 * `combineTaste` (imported from ./taste.ts) does all the derivation. This
 * component only decides what to render given the two profiles' presence
 * and the enrichment `progress`.
 */
export function TasteProfile({ partner1, partner2, genresByArtistId, progress }: TasteProfileProps) {
  const outstanding = [partner1, partner2].filter((p) => p.profile === null);

  if (outstanding.length > 0) {
    const names = outstanding.map((p) => p.name).join(' and ');
    return (
      <div className={styles.waiting}>
        <p>Waiting on {names} to connect Spotify.</p>
      </div>
    );
  }

  // Guarded by the outstanding.length check above -- both are non-null here.
  const combined = combineTaste(partner1.profile!, partner2.profile!, genresByArtistId);

  return (
    <div className={styles.section}>
      <h3 className={styles.heading}>Music match</h3>
      {combined.noData ? (
        <p className={styles.matchCopy}>Not enough listening history to compare yet.</p>
      ) : (
        <p className={styles.matchPercent}>{combined.matchPercent}%</p>
      )}

      <h4 className={styles.subheading}>Shared favorites</h4>
      <ArtistList artists={combined.sharedArtists} />

      <h4 className={styles.subheading}>{partner1.name} also loves</h4>
      <ArtistList artists={combined.partner1Loves} />

      <h4 className={styles.subheading}>{partner2.name} also loves</h4>
      <ArtistList artists={combined.partner2Loves} />

      <GenrePanels progress={progress} combined={combined} />
    </div>
  );
}
