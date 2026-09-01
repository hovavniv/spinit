import { notFound } from 'next/navigation';

import { pasteCodeForm } from './actions';

/**
 * `/dev/paste-code` -- development-only tool (Spotify connect plan, Task 9b).
 * Closes the redirect gap for a partner connecting from a device that is NOT
 * the dev machine: she authorizes on her own device, her browser's
 * `127.0.0.1:3000/api/spotify/callback?code=...` fails (127.0.0.1 on HER
 * machine is her own loopback, not the dev server's), and she pastes the
 * failed URL back to the developer. The developer signs into Spinit AS THAT
 * PARTNER and pastes the URL here.
 *
 * Never reachable in production -- this page and `pasteCode` each check
 * NODE_ENV independently, same as Task 9's `/dev/connect`.
 *
 * This assumes the partner's slot is already claimed (Task 9's flow) -- it
 * only closes the redirect gap, not the claim gap.
 */
export default function PasteCodePage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <main style={{ padding: 24, maxWidth: 640 }}>
      <h1>Dev: paste a Spotify callback URL</h1>
      <p>
        Sign in as the partner whose connection this is before submitting -- the
        connection is stored under the SIGNED-IN account&apos;s session, not the pasted
        URL.
      </p>

      <form action={pasteCodeForm}>
        <label htmlFor="partnerId">
          Partner id
          <input id="partnerId" type="text" name="partnerId" required />
        </label>
        <label htmlFor="url">
          Pasted callback URL (or bare code)
          <input id="url" type="text" name="url" required />
        </label>
        <button type="submit">Store connection</button>
      </form>
    </main>
  );
}
