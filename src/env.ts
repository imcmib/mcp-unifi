import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  /** Site Manager API key; remains on the Worker and is never sent to an MCP client. */
  UNIFI_API_KEY?: string;
  /** Leftover from the legacy static-token deployment; not accepted by the OAuth endpoint. */
  MCP_TOKEN?: string;
  /** Independent, randomly generated (32+ characters) owner approval secret. */
  OWNER_APPROVAL_SECRET?: string;
  /** OAuth state, client registrations, grants and tokens. */
  OAUTH_KV: KVNamespace;
  /** Injected by the Cloudflare OAuth provider on the authorization route. */
  OAUTH_PROVIDER: OAuthHelpers;
  /** Optional comma separated allowlist of console IDs. */
  ALLOWED_CONSOLES?: string;
  ENABLE_WRITES?: string;
  MAX_BATCH?: string;
  UPSTREAM_TIMEOUT_MS?: string;
}

export function writesEnabled(env: Env): boolean {
  return (env.ENABLE_WRITES ?? "false").toLowerCase() === "true";
}

export function maxBatch(env: Env): number {
  const n = Number(env.MAX_BATCH ?? "6");
  return Number.isFinite(n) && n > 0 ? Math.min(n, 12) : 6;
}

export function upstreamTimeoutMs(env: Env): number {
  const n = Number(env.UPSTREAM_TIMEOUT_MS ?? "15000");
  return Number.isFinite(n) && n > 0 ? n : 15000;
}

/**
 * Returns null when no allowlist is configured, meaning every console the key can see.
 * An empty allowlist is treated as a configuration mistake rather than as "allow none".
 */
export function allowedConsoles(env: Env): Set<string> | null {
  if (!env.ALLOWED_CONSOLES) return null;
  const ids = env.ALLOWED_CONSOLES.split(",").map((s) => s.trim()).filter(Boolean);
  return ids.length ? new Set(ids) : null;
}
