# Manual tests

## DJ Dashboard screen (visual slice)

**Date:** 2026-08-29
**What was compared:** `/design/dashboard` (the preview route, rendering `DashboardScreen` from
`demoData`) against `design/artboards/Spinit DJ Dashboard.dc.html`, the visual source of truth.
**How:** a headless Chromium session against the real dev server, screenshotted at desktop width
(1440px) and at 400px — not a source-level diff of declared CSS values, which cannot see actual
layout geometry.

### Desktop (1440px)

Matches the artboard: dark 240px sidebar with the two decorative circles, the DJ chip at the
bottom; greeting header with the eyebrow, "+ New event"; the pink live-event banner; the two-column
upcoming-events grid with both status pills rendering distinct fills and wording; the stacked
past-events rows. No visual regressions against the artboard.

### ~400px

Confirmed the responsive collapse from design §8: the sidebar becomes a full-width top strip (logo
+ nav in a row, avatar chip on the right, name/company dropped), the upcoming-events grid drops to
one column, main padding shrinks to 24px, past-event rows wrap.

**One real defect found and fixed during this check, not caught by any source-level review:** the
mobile sidebar strip's decorative circles (`.blobPink`, `.blobIndigo`) are `position: absolute`,
which requires a positioned ancestor. The design doc specified `position: static` for the collapsed
sidebar (to make it non-sticky). Setting the sidebar to `static` removes it as a positioning
context, so the circles escaped the sidebar's `overflow: hidden` entirely and floated relative to
the whole page — a large stray translucent shape bled down over the live-event banner and the
upcoming-events cards. Fixed by using `position: relative` instead, which is visually identical to
`static` for a box that was never `fixed`, but keeps the circles contained. Verified via a DOM
geometry check (`getBoundingClientRect()` on the sidebar and both blobs before and after) and a
second screenshot showing the stray shape gone. This fix is committed as part of Task 9's own
commit, alongside the rest of the responsive rules, since it's a correction to the same block of
CSS the task added — not a separate change.

### Known divergence (deliberate, not a bug)

The artboard's own eyebrow reads "Tuesday, August 27". 2026-08-27 is actually a **Thursday**
(`date -j -f "%Y-%m-%d" "2026-08-27" "+%A"` → `Thursday`). The implementation renders the correct
weekday rather than reproducing the artboard's error — recorded in design doc §5 and pinned by
`format.test.ts`.

### Not tested

CSS is not covered by automated tests — checked by eye against the artboard, as recorded above.

---

## Full verification (Task 10)

Run from the worktree root, 2026-08-29, all commands run and their real exit codes read:

```
$ npm run typecheck
> tsc --noEmit
(no output — exit 0)

$ npm run lint
> eslint
(no output — exit 0)

$ npm test -- --run
 Test Files  6 passed (6)
      Tests  56 passed (56)
(exit 0)

$ npm run build
▲ Next.js 16.3.3 (Turbopack)
✓ Compiled successfully in 2.1s
✓ Generating static pages using 8 workers (7/7)

Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /design/dashboard
├ ○ /login
└ ○ /register
(exit 0)
```

`git status` at the end of the task shows nothing unexpected under `src/`, and
`src/app/dashboard/page.tsx` was never created — confirmed via `ls src/app/dashboard`, which
reports "No such file or directory". That route belongs to `feat/supabase-auth` Task 10, not this
slice.

### A second real defect, found while trying to commit this file

`.gitignore`'s `!docs/submission/` negation (added in commit `ba20e9f`, before this task ran) does
not actually work: `git add docs/submission/manual-tests.md` was refused as ignored. `docs/` is a
bare directory pattern, and git never descends into an excluded directory to evaluate further
rules — no negation of a path underneath it can re-include anything, regardless of how it's
written (confirmed: neither `!docs/submission/` alone nor adding `!docs/submission/**` fixed it).
The working fix is `docs/*` (excludes only `docs`'s direct children, which git does still descend
into) instead of `docs/`, so the negation on `docs/submission/` actually takes effect. Verified with
`git check-ignore -v`: `docs/submission/manual-tests.md` is no longer ignored, while
`docs/specs/2026-08-29-dj-dashboard-plan.md` still is. This means the earlier commit's claim — "gitignore
un-ignores docs/submission" — was never actually exercised; it's corrected here rather than left
standing.
