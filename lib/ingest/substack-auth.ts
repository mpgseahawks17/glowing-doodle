/**
 * Build the Cookie header for authenticated Substack requests.
 *
 * `SUBSTACK_SID` accepts either form:
 *
 *   1. Just the session value        s%3AKV...
 *   2. A whole copied Cookie header  substack.sid=s%3AKV...; ab_testing_id=...
 *
 * Form 2 is preferred and is what the README tells you to copy. Hunting for a
 * single cookie in DevTools is error-prone, and if Substack ever requires a
 * companion cookie, a pasted header keeps working while a lone sid would not.
 *
 * IMPORTANT: the cookie must come from **natesilver.net**, not substack.com.
 * Substack issues separate sessions per custom domain, so a substack.com
 * session authenticates as anonymous against natesilver.net -- the failure
 * looks identical to an expired cookie.
 */
export function substackCookieHeader(
  raw = process.env.SUBSTACK_SID,
): string | null {
  const value = raw?.trim();
  if (!value) return null;

  // A pasted header already contains "name=value" pairs; send it verbatim.
  if (/^[A-Za-z0-9_.-]+=/.test(value)) return value;

  return `substack.sid=${value}`;
}

/** True when the value looks like a bare session id rather than a header. */
export function isBareSid(raw = process.env.SUBSTACK_SID): boolean {
  const value = raw?.trim();
  return !!value && !/^[A-Za-z0-9_.-]+=/.test(value);
}
