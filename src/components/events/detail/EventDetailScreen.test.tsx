import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/react';

import { EventDetailScreen } from './EventDetailScreen';
import { DETAILS_FORM_ID } from './formId';
import type { EventDetail } from '@/lib/events/detailTypes';

const EVENT_ID = '11111111-2222-4333-8444-555555555555';

/**
 * Pins the single riskiest structural fact on this page: EventDetailsForm's
 * one real <form> renders as a SIBLING of the list sections, never a wrapper
 * around them (design §2.2). If it ever became a wrapper, the browser's HTML
 * parser would silently drop the nested <form> elements MustPlaySection and
 * BlocklistSection each render for their own add/remove actions, turning
 * every add/remove button on the page into a no-op or a misdirected submit.
 *
 * This is asserted on the FULLY ASSEMBLED screen, not an isolated component:
 * CeremonySongs.test.tsx only pins that CeremonySongs itself renders no
 * <form>, not that EventDetailScreen's actual composition keeps the details
 * form as a sibling once every section is present together.
 */
function buildEvent(): EventDetail {
  return {
    id: EVENT_ID,
    couple_names: 'Noa & Eitan',
    couple_status: 'awaiting-couple',
    notes: null,
    mustPlay: [
      {
        id: 'must-1',
        segment: 'party',
        title: 'September',
        artist: 'Earth, Wind & Fire',
        moment: null,
        created_at: '2026-08-30T10:00:00Z',
      },
    ],
    blocklist: [
      {
        id: 'block-1',
        segment: 'reception',
        entry_type: 'artist',
        value: 'Nickelback',
        created_at: '2026-08-30T10:00:00Z',
      },
    ],
  };
}

describe('EventDetailScreen', () => {
  test('the details form has a unique id and is not a wrapper around the list sections', () => {
    const { container } = render(<EventDetailScreen event={buildEvent()} />);

    // Exactly one form carries the details-form id -- it is not duplicated
    // and it is trivially locatable by id, the same way EventDetailsForm.tsx
    // wires the ceremony inputs and notes textarea to it via `form={id}`.
    const detailsForms = Array.from(container.querySelectorAll('form')).filter(
      (form) => form.id === DETAILS_FORM_ID,
    );
    expect(detailsForms).toHaveLength(1);
    const [detailsForm] = detailsForms;

    // If EventDetailsForm ever became a WRAPPER instead of a sibling, the
    // list sections' own add/remove forms would render NESTED inside this
    // one -- exactly the shape a real browser's HTML parser silently drops.
    // Asserting zero <form> descendants of the details form is what proves
    // it stayed a sibling.
    expect(detailsForm.querySelectorAll('form')).toHaveLength(0);

    // The list sections DO render their own forms elsewhere in the tree --
    // this fixture carries a real mustPlay row and a real blocklist row
    // precisely so that is true here (add form + remove form per section
    // with a row, add form alone for the two empty segments), not only on
    // an empty page.
    expect(container.querySelectorAll('form').length).toBeGreaterThan(1);
  });
});
