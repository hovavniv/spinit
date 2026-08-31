import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { EventDetailScreen } from './EventDetailScreen';
import { DETAILS_FORM_ID } from './formId';
import type { EventDetail } from '@/lib/events/detailTypes';

const EVENT_ID = '11111111-2222-4333-8444-555555555555';

/**
 * Asserts the real invariant: no <form> on the page has a <form> ANCESTOR.
 * `detailsForm.querySelectorAll('form')` only proves a form has no form
 * DESCENDANTS -- EventDetailsForm renders no children at all, so that
 * assertion is structurally incapable of failing and would stay green even
 * if some OTHER element wrapped every form on the page, details form
 * included, in an outer <form> (exactly the §2.2 defect these tests exist to
 * catch). Walking up from each form's parentElement is what actually tests
 * for nesting in either direction.
 */
function assertNoFormIsNestedInAnotherForm(container: HTMLElement) {
  const forms = Array.from(container.querySelectorAll('form'));
  for (const form of forms) {
    expect(form.parentElement?.closest('form') ?? null).toBeNull();
  }
}

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
    dj_id: 'dj-1',
    privateNotes: 'DJ private note',
    sharedNotes: 'Couple shared note',
    partners: [],
    mustPlay: [
      {
        id: 'must-1',
        segment: 'party',
        title: 'September',
        artist: 'Earth, Wind & Fire',
        moment: null,
        spotify_track_id: 'aaaaaaaaaaaaaaaaaaaaaa',
        spotify_artist_id: 'bbbbbbbbbbbbbbbbbbbbbb',
        created_at: '2026-08-30T10:00:00Z',
      },
    ],
    blocklist: [
      {
        id: 'block-1',
        segment: 'reception',
        entry_type: 'artist',
        value: 'Nickelback',
        spotify_id: 'cccccccccccccccccccccc',
        created_at: '2026-08-30T10:00:00Z',
      },
    ],
  };
}

describe('EventDetailScreen', () => {
  test('the details form has a unique id and is not a wrapper around the list sections', () => {
    const { container } = render(
      <EventDetailScreen event={buildEvent()} viewer={{ role: 'dj' }} />,
    );

    // Exactly one form carries the details-form id -- it is not duplicated
    // and it is trivially locatable by id, the same way EventDetailsForm.tsx
    // wires the ceremony inputs to it via `form={id}`.
    const detailsForms = Array.from(container.querySelectorAll('form')).filter(
      (form) => form.id === DETAILS_FORM_ID,
    );
    expect(detailsForms).toHaveLength(1);

    // If EventDetailsForm ever became a WRAPPER instead of a sibling, the
    // list sections' own add/remove forms would render NESTED inside this
    // one -- exactly the shape a real browser's HTML parser silently drops.
    // EventDetailsForm renders no children, so a descendant-only check can
    // never fail; walking up from every form's parent is what actually
    // proves nothing on the page nests one form inside another.
    assertNoFormIsNestedInAnotherForm(container);

    // The list sections DO render their own forms elsewhere in the tree --
    // this fixture carries a real mustPlay row and a real blocklist row
    // precisely so that is true here (add form + remove form per section
    // with a row, add form alone for the two empty segments), not only on
    // an empty page.
    expect(container.querySelectorAll('form').length).toBeGreaterThan(1);
  });

  test('shows the private notes field to the dj', () => {
    render(<EventDetailScreen event={buildEvent()} viewer={{ role: 'dj' }} />);

    expect(screen.getByText(/only you can see this/i)).toBeInTheDocument();
  });

  test('hides the private notes field from a partner', () => {
    // A convenience, not the control: a partner's read never returns that row
    // because the policy filters it (design §3). Hiding it keeps the screen
    // from drawing an empty box the partner could type into and lose.
    render(
      <EventDetailScreen
        event={buildEvent()}
        viewer={{ role: 'partner', partnerId: 'p1' }}
      />,
    );

    expect(screen.queryByText(/only you can see this/i)).not.toBeInTheDocument();
  });

  test('shows shared notes to both', () => {
    for (const viewer of [
      { role: 'dj' } as const,
      { role: 'partner', partnerId: 'p1' } as const,
    ]) {
      const { unmount } = render(
        <EventDetailScreen event={buildEvent()} viewer={viewer} />,
      );

      expect(screen.getByText(/couple can see/i)).toBeInTheDocument();
      unmount();
    }
  });

  test('each notes textarea holds its own body, not the other one\'s', () => {
    render(<EventDetailScreen event={buildEvent()} viewer={{ role: 'dj' }} />);

    expect(screen.getByLabelText(/your private notes/i)).toHaveValue('DJ private note');
    expect(screen.getByLabelText(/shared notes/i)).toHaveValue('Couple shared note');
  });

  test('the notes forms are siblings of the details form, not nested in it', () => {
    // Both note sections are their own <form> now. Nested forms are dropped
    // by the parser, so this is the same structural trap the first test pins,
    // one section over (design §2.2).
    const { container } = render(
      <EventDetailScreen event={buildEvent()} viewer={{ role: 'dj' }} />,
    );

    assertNoFormIsNestedInAnotherForm(container);
    expect(screen.getByLabelText(/your private notes/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/shared notes/i)).toBeInTheDocument();
  });
});
