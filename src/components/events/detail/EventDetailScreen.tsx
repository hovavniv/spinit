import Link from 'next/link';

import type { EventDetail, Viewer } from '@/lib/events/detailTypes';
import { splitBySegment } from '@/lib/events/segments';
import {
  addMustPlay,
  removeMustPlay,
  addBlocklistEntry,
  removeBlocklistEntry,
  saveEventDetails,
} from '@/lib/events/detailActions';
import { savePrivateNotes, saveSharedNotes } from '@/lib/events/notesActions';
import { StepHeader } from './StepHeader';
import { StreamingSection, type StreamingConnections } from './StreamingSection';
import { TasteProfile } from './TasteProfile';
import { CeremonySongs } from './CeremonySongs';
import { MustPlaySection } from './MustPlaySection';
import { BlocklistSection } from './BlocklistSection';
import { NotesSection } from './NotesSection';
import { SharedNotesSection } from './SharedNotesSection';
import { EventDetailsForm } from './EventDetailsForm';
import styles from './EventDetailScreen.module.css';

interface EventDetailScreenProps {
  event: EventDetail;
  viewer: Viewer;
}

/**
 * The New Event artboard as it renders for an EXISTING event: step 3, titled
 * with the couple's names, its primary button "Save changes"
 * (design §2.1, §4).
 *
 * `viewer` decides which note fields render (design §4). It is resolved on
 * the server in page.tsx, never here: a Client Component cannot be trusted
 * with an authorization decision, and this one is only a rendering choice.
 *
 * The actions are imported here and threaded down as props. The list sections
 * and the note sections are all Client Components and must not import their
 * own actions: an action module is 'use server' and pulls in the DAL's
 * `import 'server-only'`, which cannot be evaluated in jsdom — the trap
 * DashboardSidebar already documents.
 */
export function EventDetailScreen({ event, viewer }: EventDetailScreenProps) {
  const mustPlay = splitBySegment(event.mustPlay);
  const blocklist = splitBySegment(event.blocklist);

  const connections: StreamingConnections = {};
  for (const partner of event.partners) {
    connections[partner.id] = partner.connection;
  }

  const [partner1, partner2] = event.partners;

  return (
    <div className={styles.page}>
      <Link href="/dashboard" className={styles.backLink}>
        ← Back to dashboard
      </Link>

      <h1 className={styles.title}>{event.couple_names}</h1>

      <StepHeader />

      <div className={styles.card}>
        <StreamingSection partners={event.partners} connections={connections} viewer={viewer} />

        {partner1 && partner2 && (
          <TasteProfile
            partner1={{ name: partner1.display_name, profile: partner1.profile }}
            partner2={{ name: partner2.display_name, profile: partner2.profile }}
          />
        )}

        <CeremonySongs rows={mustPlay.ceremony} />

        <section className={styles.segment}>
          <h3 className={styles.segmentHeading}>Reception</h3>
          <MustPlaySection
            eventId={event.id}
            segment="reception"
            blurb="Dinner, toasts, first dance — songs to guarantee during the reception."
            rows={mustPlay.reception}
            addAction={addMustPlay}
            removeAction={removeMustPlay}
          />
          <BlocklistSection
            eventId={event.id}
            segment="reception"
            blurb="Keep these off the reception — cocktail hour, dinner, toasts."
            rows={blocklist.reception}
            addAction={addBlocklistEntry}
            removeAction={removeBlocklistEntry}
          />
        </section>

        <section className={styles.segment}>
          <h3 className={styles.segmentHeading}>Party</h3>
          <MustPlaySection
            eventId={event.id}
            segment="party"
            blurb="Peak dance floor — songs to guarantee once the party gets going."
            rows={mustPlay.party}
            addAction={addMustPlay}
            removeAction={removeMustPlay}
          />
          <BlocklistSection
            eventId={event.id}
            segment="party"
            blurb="Keep these off the dance floor — exes, breakup songs, that one cover band."
            rows={blocklist.party}
            addAction={addBlocklistEntry}
            removeAction={removeBlocklistEntry}
          />
        </section>

        {/*
          Hiding the private field from a partner is a CONVENIENCE, not the
          control -- their read never returns that row, because the policy
          filters it (design §3). Rendering it anyway would draw an empty box
          they could type into and lose. Do not rely on this in either
          direction.
        */}
        {viewer.role === 'dj' && (
          <NotesSection
            eventId={event.id}
            body={event.privateNotes}
            saveAction={savePrivateNotes}
          />
        )}

        <SharedNotesSection
          eventId={event.id}
          body={event.sharedNotes}
          saveAction={saveSharedNotes}
          isDj={viewer.role === 'dj'}
        />

        <EventDetailsForm eventId={event.id} saveAction={saveEventDetails} />
      </div>
    </div>
  );
}
