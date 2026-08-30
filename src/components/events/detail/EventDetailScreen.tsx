import Link from 'next/link';

import type { EventDetail } from '@/lib/events/detailTypes';
import { splitBySegment } from '@/lib/events/segments';
import {
  addMustPlay,
  removeMustPlay,
  addBlocklistEntry,
  removeBlocklistEntry,
  saveEventDetails,
} from '@/lib/events/detailActions';
import { StepHeader } from './StepHeader';
import { StreamingSection } from './StreamingSection';
import { CeremonySongs } from './CeremonySongs';
import { MustPlaySection } from './MustPlaySection';
import { BlocklistSection } from './BlocklistSection';
import { NotesSection } from './NotesSection';
import { EventDetailsForm } from './EventDetailsForm';
import styles from './EventDetailScreen.module.css';

interface EventDetailScreenProps {
  event: EventDetail;
}

/**
 * The New Event artboard as it renders for an EXISTING event: step 3, titled
 * with the couple's names, its primary button "Save changes"
 * (design §2.1, §4).
 *
 * The actions are imported here and threaded down as props. The list sections
 * are Client Components and must not import them: an action module is
 * 'use server' and pulls in the DAL's `import 'server-only'`, which cannot be
 * evaluated in jsdom — the trap DashboardSidebar already documents.
 */
export function EventDetailScreen({ event }: EventDetailScreenProps) {
  const mustPlay = splitBySegment(event.mustPlay);
  const blocklist = splitBySegment(event.blocklist);

  return (
    <div className={styles.page}>
      <Link href="/dashboard" className={styles.backLink}>
        ← Back to dashboard
      </Link>

      <h1 className={styles.title}>{event.couple_names}</h1>

      <StepHeader />

      <div className={styles.card}>
        <StreamingSection coupleStatus={event.couple_status} />

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

        <NotesSection notes={event.notes} />

        <EventDetailsForm eventId={event.id} saveAction={saveEventDetails} />
      </div>
    </div>
  );
}
