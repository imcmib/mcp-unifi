/**
 * A dedicated, randomly generated owner approval secret is entered only on the
 * OAuth consent page over HTTPS. This is NOT the UniFi API key or old MCP token.
 */
export function matchesOwnerSecret(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== "string" || candidate.length > 4096 || expected.length < 43) return false;
  const enc = new TextEncoder();
  const a = enc.encode(candidate);
  const b = enc.encode(expected);
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}
