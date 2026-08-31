import { CEREMONY_SLOTS } from '@/lib/events/ceremonySlots';
import type { MustPlayRow } from '@/lib/events/detailTypes';
import { DETAILS_FORM_ID } from './formId';
import { TrackPicker } from './TrackPicker';
import styles from './CeremonySongs.module.css';

interface CeremonySongsProps {
  /** The ceremony rows only — the caller has already split by segment. */
  rows: MustPlayRow[];
}

/**
 * The artboard's two labelled ceremony slots, drawn exactly as it draws them.
 * The two-slot rendering is the artboard's; the STORAGE is rows in
 * event_must_play, so a third moment later is a constant here rather than a
 * migration (design §2.3).
 *
 * Fields are named by slot INDEX — the moment string never travels through the
 * form, so the page cannot be used to write an arbitrary ceremony moment
 * (design §6.3). The hidden id is what lets saveEventDetails write by row id.
 *
 * Every control carries form="event-details" instead of living inside a
 * <form>: this component renders between the list sections and their forms,
 * and nested forms are dropped by the HTML parser (design §2.2).
 */
export function CeremonySongs({ rows }: CeremonySongsProps) {
  return (
    <section className={styles.section}>
      <h3 className={styles.heading}>Ceremony songs</h3>
      <p className={styles.blurb}>
        Key ceremony moments — confirm these with the couple ahead of time.
      </p>

      <div className={styles.slots}>
        {CEREMONY_SLOTS.map((slot, index) => {
          const existing = rows.find((row) => row.moment === slot.moment);
          return (
            <div key={slot.moment}>
              <div className={styles.slotLabel}>{slot.label}</div>
              <input
                type="hidden"
                name={`ceremony-${index}-id`}
                value={existing?.id ?? ''}
                form={DETAILS_FORM_ID}
                readOnly
              />
              <div className={styles.slotRow}>
                <TrackPicker
                  namePrefix={`ceremony-${index}-`}
                  formId={DETAILS_FORM_ID}
                  fields={{ kind: 'titleArtist', titleName: 'title', artistName: 'artist' }}
                  // A row saved before pickers existed has a title but no
                  // spotify_track_id (B2 added the column nullable; nothing
                  // has backfilled it). Seeding a chip from that would show a
                  // "picked" state whose hidden id is empty — clicking Save
                  // without touching this slot would then fail validation on
                  // a slot that LOOKED fine. Only seed the chip when there is
                  // a real id to seed it with; otherwise this renders an
                  // empty picker, correctly prompting a re-pick.
                  initialPick={
                    existing?.spotify_track_id
                      ? {
                          id: existing.spotify_track_id,
                          name: existing.title,
                          artistName: existing.artist ?? undefined,
                          // Without this, buildInitialPick's artistIds is [],
                          // so the hidden spotifyArtistId input renders '' --
                          // and saving this slot untouched would then write
                          // that '' as null over a real artist id the row
                          // already had (found by fresh-context review).
                          artistId: existing.spotify_artist_id ?? undefined,
                        }
                      : null
                  }
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
