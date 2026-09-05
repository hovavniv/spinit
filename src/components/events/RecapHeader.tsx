import Link from 'next/link';

import { formatPastDate } from '@/lib/dashboard/format';
import type { RecapEvent } from '@/lib/events/types';
import styles from './RecapHeader.module.css';

const SEND_HINT = "Coming soon — emailing the recap to the couple isn't built yet.";

/**
 * The top of design/artboards/Spinit Event Recap.dc.html: back link, then the
 * eyebrow / title / subtitle block with the Send button pushed to the right.
 *
 * DEVIATION: the artboard's back link says "Back to dashboard". Past events is
 * the only route that links into a recap, so it points there instead
 * (design §7.1).
 */
export function RecapHeader({ event }: { event: RecapEvent }) {
  return (
    <>
      <Link href="/events/past" className={styles.back}>
        ← Back to past events
      </Link>

      <div className={styles.row}>
        <div>
          {/* Hardcoded, and no longer for the reason this comment used to give. The DAL
              returns ENDED events, which since 20260904120000 means completed OR
              date-passed -- so this can render for an event whose status is still
              'upcoming' and which no DJ ever ended. "Completed" is still the right word
              for a wedding that has happened; if that ever stops being true, the fix is
              to derive the label from the row, which now carries `status`. */}
          <div className={styles.eyebrow}>Completed</div>
          <h1 className={styles.title}>{event.couple_names}</h1>
          <div className={styles.subtitle}>
            {formatPastDate(event.event_date)} · {event.venue}
          </div>
        </div>

        {/* aria-disabled, NOT the `disabled` attribute. A disabled button is
            not focusable, so a keyboard user could never reach the
            explanation of why it is disabled -- neither the title nor
            anything inside the button. aria-disabled announces the state and
            keeps it in the tab order. There is no click handler, so it does
            nothing when activated (design §7.2). */}
        <button
          type="button"
          className={styles.send}
          aria-disabled="true"
          aria-describedby="send-to-couple-hint"
          title={SEND_HINT}
        >
          Send to couple
        </button>
        {/* The description lives here rather than being repeated inside the
            button: assistive tech that exposes both `title` and a child span
            would otherwise announce the same sentence twice. */}
        <span id="send-to-couple-hint" className="srOnly">
          {SEND_HINT}
        </span>
      </div>
    </>
  );
}
