import type { PartnerRow, Viewer } from '@/lib/events/detailTypes';
import { connectSpotify, resyncSpotify } from '@/lib/spotify/actions';
import styles from './StreamingSection.module.css';

export interface StreamingConnection {
  status: 'invited' | 'connected' | 'failed';
}

/** Keyed by partner id. `null` (or a missing key) means no connection row exists yet. */
export type StreamingConnections = Record<string, StreamingConnection | null>;

interface StreamingSectionProps {
  partners: PartnerRow[];
  connections: StreamingConnections;
  viewer: Viewer;
}

/**
 * The artboard's streaming-profiles block, now wired to the real Spotify
 * connect/re-sync actions (Task 10). One status row per partner.
 *
 * Every action here (Connect, Try again, Re-sync) only shows on the row
 * belonging to the partner currently viewing the page: `connectSpotify` and
 * `resyncSpotify` both check ownership server-side (actions.ts) and throw for
 * anyone who is not that partner, so showing the control anywhere else would
 * be a button that always fails. The DJ never sees any of these three
 * buttons for the same reason -- they are never the owning partner.
 *
 * No Disconnect control here (task's own scoping decision) -- the action
 * exists and is tested at the action layer, but stays action-only for now.
 *
 * Each button gets its OWN small <form>, a sibling of every other form this
 * component renders and a sibling of the page's details form (never nested
 * inside either) -- nested forms are silently dropped by the HTML parser
 * (see CeremonySongs.tsx / EventDetailsForm.tsx for the same reasoning
 * elsewhere on this page).
 */
export function StreamingSection({ partners, connections, viewer }: StreamingSectionProps) {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Connect streaming profiles</h2>
      <p className={styles.blurb}>
        Each partner connects their own Spotify account from their own device — the DJ never
        connects on their behalf.
      </p>

      {partners.map((partner) => {
        const connection = connections[partner.id] ?? null;
        const status = connection?.status ?? null;
        const isOwnRow = viewer.role === 'partner' && viewer.partnerId === partner.id;
        const isConnected = status === 'connected';
        const isFailed = status === 'failed';

        return (
          <div key={partner.id} className={styles.statusRow}>
            <div>
              <div className={styles.statusTitle}>{partner.display_name}</div>
              <div className={styles.statusDetail}>
                {isConnected && 'Spotify connected.'}
                {isFailed && "Couldn't connect. Retry to link their account."}
                {!isConnected && !isFailed && 'Not connected yet.'}
              </div>
            </div>

            <span className={isConnected ? styles.pillConnected : styles.pillAwaiting}>
              {isConnected ? 'Connected' : isFailed ? 'Try again' : 'Not connected'}
            </span>

            {isOwnRow && isConnected && (
              <form action={resyncSpotify} className={styles.actionForm}>
                <input type="hidden" name="partnerId" value={partner.id} />
                {/*
                  Spotify's /me/top/* endpoints are a batch aggregate with
                  hours-to-days lag, not a live feed -- this copy must never
                  promise a re-sync picks up recent listening (design note,
                  Task 10).
                */}
                <button type="submit" className={styles.actionButton}>
                  Re-sync taste profile
                </button>
              </form>
            )}

            {isOwnRow && !isConnected && (
              <form action={connectSpotify} className={styles.actionForm}>
                <input type="hidden" name="partnerId" value={partner.id} />
                <button
                  type="submit"
                  className={styles.actionButton}
                  aria-label={
                    isFailed
                      ? `Try again — connect ${partner.display_name}'s Spotify`
                      : `Connect ${partner.display_name}'s Spotify`
                  }
                >
                  {isFailed ? 'Try again' : 'Connect'}
                </button>
              </form>
            )}
          </div>
        );
      })}
    </section>
  );
}
