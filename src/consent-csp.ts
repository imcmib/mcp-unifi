/**
 * The consent form POST goes to this Worker, but successful authorization sends
 * the browser via HTTP 302 to the registered ChatGPT callback.
 * Chromium and WebKit also apply form-action to the redirect chain, so the
 * exact ChatGPT origin must be allowlisted here.
 *
 * This CSP does not replace the OAuth provider's exact redirect URI validation.
 */
export const CONSENT_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://chatgpt.com; base-uri 'none'; frame-ancestors 'none'";
