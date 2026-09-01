/** Accepts either a full redirect URL or a bare `code`. Lives outside the
 *  'use server' module because every export of one of those becomes a
 *  server-action endpoint and must be async -- a plain helper cannot live there. */
export function codeFrom(pasted: string): string {
  try {
    const code = new URL(pasted).searchParams.get('code');
    if (code) return code;
  } catch {
    // Not a URL -- treat the whole string as a bare code.
  }
  return pasted.trim();
}
