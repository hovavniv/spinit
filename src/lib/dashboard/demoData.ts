/* ---------------------------------------------------------------------------
   Demo fixture for the DJ Dashboard screen (design/specs/2026-08-29-dj-dashboard-design.md §5).

   Every string below is copied verbatim from
   `design/artboards/Spinit DJ Dashboard.dc.html`, typed against
   `src/lib/dashboard/types.ts`.

   `now` is pinned to 2026-08-27T20:00 local — see design §5's "known
   divergence" note: the artboard's own eyebrow reads "Tuesday, August 27",
   but 2026-08-27 is actually a Thursday. This fixture reproduces the
   artboard's greeting ("Good evening") and both day counts ("in 16 days" /
   "in 37 days") without reproducing that one wrong weekday.
   --------------------------------------------------------------------------- */

import type { DashboardData } from './types';

export const demoData: DashboardData = {
  dj: {
    name: 'Jordan Ellis',
    company: 'Ellis Sound Co.',
  },
  now: '2026-08-27T20:00',
  liveEvent: {
    id: 'maya-tomer',
    coupleNames: 'Maya & Tomer',
    venue: 'The Wilshire Ebell',
    phase: 'open-floor',
    startedAt: '2026-08-27T20:00:00-07:00',
  },
  upcoming: [
    {
      id: 'priya-alex',
      coupleNames: 'Priya & Alex',
      venue: 'Brookline Barn',
      date: '2026-09-12',
      status: 'streaming-connected',
    },
    {
      id: 'sam-jordan',
      coupleNames: 'Sam & Jordan R.',
      venue: 'The Foundry',
      date: '2026-10-03',
      status: 'awaiting-couple',
    },
  ],
  past: [
    {
      id: 'noa-eitan',
      coupleNames: 'Noa & Eitan',
      venue: 'Franklin Hall',
      date: '2026-07-18',
      songsPlayed: 10,
    },
    {
      id: 'claire-ben',
      coupleNames: 'Claire & Ben',
      venue: 'Rooftop at Dune',
      date: '2026-06-06',
      songsPlayed: 8,
    },
  ],
};
