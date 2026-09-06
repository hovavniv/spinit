import Link from 'next/link';

import type { EventDetail, Viewer } from '@/lib/events/detailTypes';
import { splitBySegment } from '@/lib/events/segments';
import {
  addMustPlay,
  removeMustPlay,
  addBlocklistEntry,
  removeBlocklistEntry,
  saveEventDetails,
  endEvent,
} from '@/lib/events/detailActions';
import { savePrivateNotes, saveSharedNotes } from '@/lib/events/notesActions';
import { hasEventDatePassed } from '@/lib/events/lifecycle';
import { startEvent } from '@/lib/live/liveActions';
import { StepHeader } from './StepHeader';
import { StreamingSection, type StreamingConnections } from './StreamingSection';
import { TasteProfileClient } from './TasteProfileClient';
import { CeremonySongs } from './CeremonySongs';
import { MustPlaySection } from './MustPlaySection';
import { BlocklistSection } from './BlocklistSection';
import { NotesSection } from './NotesSection';
import { SharedNotesSection } from './SharedNotesSection';
import { EventDetailsForm } from './EventDetailsForm';
import { EndEventSection } from './EndEventSection';
import { StartEventSection } from './StartEventSection';
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

  // Server-side, so `today` is APP_TIMEZONE and not the viewer's browser.
  // A live event is exempt from the date rule, so only 'upcoming' is checked
  // against the date; a past-dated upcoming event has already ended and needs
  // no button (design §3.5, §3.6).
  const isEndable = event.status === 'upcoming' || event.status === 'live';
  const alreadyEndedByDate = event.status === 'upcoming' && hasEventDatePassed(event.event_date);
  const canEnd = viewer.role === 'dj' && isEndable && !alreadyEndedByDate;

  // Reuses alreadyEndedByDate rather than a second date comparison (design
  // §5.2b, live-event slice): two predicates answering "has this event's
  // date passed" is how they drift apart, and Start/End must agree on it or
  // an event could show both buttons or neither.
  const canStart = viewer.role === 'dj' && event.status === 'upcoming' && !alreadyEndedByDate;

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
          // TasteProfileClient (plan task 10) polls each partner's own
          // enrichment queue and combines the two into the one `progress`
          // TasteProfile expects -- see that file's header comment for the
          // combination rule, which nothing in the plan or design specifies.
          <TasteProfileClient
            partner1={partner1}
            partner2={partner2}
            genresByArtistId={event.genresByArtistId}
            enrichmentProgress={event.enrichmentProgress}
          />
        )}

        <CeremonySongs rows={mustPlay.ceremony} artworkById={event.artworkById} />

        <section className={styles.segment}>
          <h3 className={styles.segmentHeading}>Reception</h3>
          <MustPlaySection
            eventId={event.id}
            segment="reception"
            blurb="Dinner, toasts, first dance — songs to guarantee during the reception."
            rows={mustPlay.reception}
            artworkById={event.artworkById}
            addAction={addMustPlay}
            removeAction={removeMustPlay}
          />
          <BlocklistSection
            eventId={event.id}
            segment="reception"
            blurb="Keep these off the reception — cocktail hour, dinner, toasts."
            rows={blocklist.reception}
            artworkById={event.artworkById}
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
            artworkById={event.artworkById}
            addAction={addMustPlay}
            removeAction={removeMustPlay}
          />
          <BlocklistSection
            eventId={event.id}
            segment="party"
            blurb="Keep these off the dance floor — exes, breakup songs, that one cover band."
            rows={blocklist.party}
            artworkById={event.artworkById}
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

        {/*
          Start and End answer one question -- what happens to this event --
          so they are one titled section, like every other block in this card,
          and they sit ABOVE the Back/Save footer: that footer ends the page,
          and anything after it reads as an afterthought. Only drawn when one
          of them will render something (each returns null on its own flag).

          canStart implies canEnd -- both require a DJ on an in-date event,
          and canStart narrows that to 'upcoming' -- so the only two states
          are "both" (upcoming) and "End only" (live). The blurb says so.
        */}
        {(canStart || canEnd) && (
          <section className={styles.lifecycle}>
            <h3 className={styles.lifecycleHeading}>Event day</h3>
            <p className={styles.lifecycleBlurb}>
              {canStart
                ? 'Start the event when guests arrive — that opens requests and takes you to the live screen. Ending it closes requests and delivers the recap.'
                : 'Ending the event closes requests and delivers the recap.'}
            </p>
            <div className={styles.lifecycleActions}>
              <StartEventSection eventId={event.id} canStart={canStart} startEventAction={startEvent} />
              <EndEventSection eventId={event.id} canEnd={canEnd} endAction={endEvent} />
            </div>
          </section>
        )}

        <EventDetailsForm eventId={event.id} saveAction={saveEventDetails} />
      </div>
    </div>
  );
}
