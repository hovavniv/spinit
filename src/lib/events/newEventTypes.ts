import type { ActionResult } from '@/lib/auth/errors';

/** One `event_partners` row, as the wizard reads it. */
export interface WizardPartner {
  slot: 1 | 2;
  display_name: string;
  invite_email: string;
}

/** Everything the four wizard routes render, from getEventForWizard. */
export interface WizardEvent {
  id: string;
  couple_names: string;
  partner1_name: string | null;
  partner2_name: string | null;
  /** 'YYYY-MM-DD'. Never pass this to `new Date(string)` — see format.ts. */
  event_date: string;
  venue: string;
  guest_count: number | null;
  status: 'draft' | 'upcoming';
  partners: WizardPartner[];
}

/**
 * `useActionState`'s state for every wizard form. `null` is "not submitted
 * yet", which a render must be able to tell apart from a result. Identical in
 * shape to DetailActionState; named for this feature so the wizard does not
 * import from the event-detail module.
 */
export type WizardActionState = ActionResult | null;
