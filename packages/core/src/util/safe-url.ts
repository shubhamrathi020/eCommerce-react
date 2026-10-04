/**
 * Accepts only in-app paths for post-login redirects (`/orders`, `/p/x?variant=1`).
 * Anything else (other sites, protocol-relative `//evil.test`, `javascript:`) falls back, preventing open redirects.
 */
export function safeReturnUrl(url: string | null | undefined, fallback = '/account'): string {
  if (!url) return fallback;
  if (!url.startsWith('/') || url.startsWith('//') || url.startsWith('/\\') || /[\r\n\t]/.test(url)) return fallback;
  // Never bounce back to the auth pages themselves.
  if (url.startsWith('/account/login') || url.startsWith('/account/register')) return fallback;
  return url;
}
