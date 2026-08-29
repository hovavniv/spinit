const ALLOWED_REDIRECTS = new Set(['/dashboard']);

export function safeRedirect(raw: string | null): string {
  return raw !== null && ALLOWED_REDIRECTS.has(raw) ? raw : '/dashboard';
}
