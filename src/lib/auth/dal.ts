import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

/**
 * The row shape of `public.profiles` (design 5.1). No generated Supabase
 * types exist yet in this repo, so this is hand-written to match the
 * migration exactly.
 */
export interface Profile {
  id: string;
  full_name: string;
  business_name: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The real authorization gate (design 3's "Real gate" row). Calls
 * `supabase.auth.getUser()` — never `getSession()` — which round-trips to
 * Supabase's auth server to verify the JWT rather than trusting whatever the
 * session cookie says (design 2.3). Wrapped in React `cache()` so that
 * multiple calls within one render (e.g. a page and the layout it renders
 * inside, or a page and a server action it invokes) hit the network once.
 *
 * Fails closed: any error, or the absence of a user, redirects to `/login`
 * rather than returning null/undefined and leaving it to the caller to
 * remember to check (design 7.2). Every protected page and every server
 * action calls this before doing anything else.
 */
export const requireUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect('/login');
  }

  return user;
});

/**
 * Reads the CURRENT verified user's own `profiles` row. Deliberately takes
 * no id argument from a caller — it calls `requireUser()` itself, so a
 * forgotten `requireUser()` call upstream can never turn this into a way to
 * read an arbitrary row by id. Postgres RLS (design 5.2) already restricts a
 * `select` to the caller's own row regardless, but that is the backstop, not
 * the primary control at this layer (design 3): the actual hole a design
 * like this closes is an application-code path that never verified the
 * caller's identity in the first place.
 */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, business_name, phone, created_at, updated_at')
    .eq('id', user.id)
    .single();

  if (error) {
    console.error('getProfile: failed to load profile', { userId: user.id, message: error.message });
    return null;
  }

  return data;
});
