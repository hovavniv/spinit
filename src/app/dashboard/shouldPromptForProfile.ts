import type { Profile } from '@/lib/auth/dal';

/**
 * A pure, synchronous predicate deciding whether `/dashboard` should show
 * the "finish your profile" form (design 1, design 4.6). Extracted out of
 * `page.tsx` specifically so it has a plain unit test (design 10.1, design
 * 10.3) — the page itself is an async server component that RTL cannot
 * meaningfully render, and `dal.ts` (which defines `Profile`) carries
 * `import 'server-only'`, so this file must stay free of any import that
 * would drag that in at runtime; only the type is imported, which is erased
 * at compile time.
 *
 * `business_name` is null for a Google user: the `handle_new_user` trigger
 * (design 5.3) seeds `full_name` from Google's `name` claim but has nothing
 * to seed `business_name`/`phone` from, since Google's OAuth profile does not
 * carry either. A null `business_name` is therefore the signal that the
 * profile still needs completing.
 *
 * `profile === null` also prompts: `getProfile()` returns null when the read
 * itself failed (dal.ts logs and returns null rather than throwing), so
 * there is no profile data to show either way — prompting the completion
 * form is the same "there's nothing populated yet" case as a fresh Google
 * signup, and is safer than silently rendering an empty read-only view.
 */
export function shouldPromptForProfile(profile: Profile | null): boolean {
  if (profile === null) {
    return true;
  }
  return profile.business_name === null;
}
