import { combineTaste } from '@/lib/spotify/taste';
import type { ScoredArtist, TasteProfile as TasteProfileType } from '@/lib/spotify/tasteTypes';
import styles from './TasteProfile.module.css';

interface PartnerTaste {
  name: string;
  profile: TasteProfileType | null;
}

interface TasteProfileProps {
  partner1: PartnerTaste;
  partner2: PartnerTaste;
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
 * The couple's shared-taste report (design §6.1, C1 slice).
 *
 * Pure presentational: both profiles are already-computed props, and
 * `combineTaste` (imported from ./taste.ts) does all the derivation. This
 * component only decides what to render given the two profiles' presence.
 *
 * C1 renders artist panels ONLY -- no Top genres / Probably steer clear of
 * panels, not even a placeholder. Genres do not exist until a later slice
 * (no `artist_genres` enrichment yet), so a "still analysing" placeholder
 * here would promise something nothing in this codebase can currently keep.
 */
export function TasteProfile({ partner1, partner2 }: TasteProfileProps) {
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
  const combined = combineTaste(partner1.profile!, partner2.profile!);

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
    </div>
  );
}
