import { AuthorizationError, OAuthProvider } from "@cloudflare/workers-oauth-provider";
import type { Env } from "./env";
import { matchesOwnerSecret } from "./owner";
import { toolsFor } from "./tools";
import { UnifiClient, UnifiError } from "./unifi";

// The OAuth resource identifier must match the public URL configured in ChatGPT.
// Do not replace this with a private LAN, VPN, or dashboard URL.
const ORIGIN = "https://mcp-unifi.imcmib.workers.dev";
const RESOURCE = `${ORIGIN}/mcp`;
const READ_SCOPE = "mcp:read";
const PROTOCOL_VERSION = "2024-11-05";

interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, any>;
}

function result(id: unknown, value: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result: value }, { headers: { "cache-control": "no-store" } });
}

function rpcError(id: unknown, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { headers: { "cache-control": "no-store" } });
}

function toolFailure(id: unknown, message: string): Response {
  return result(id, { content: [{ type: "text", text: message }], isError: true });
}

function safeTools(env: Env) {
  // No escape hatch, write tools, or arbitrary proxy requests exposed to ChatGPT.
  return toolsFor(env).filter((tool) => tool.name !== "raw_request" && tool.name !== "apply_config");
}

function isConfigured(env: Env): boolean {
  return Boolean(env.UNIFI_API_KEY && env.OWNER_APPROVAL_SECRET &&
    env.OWNER_APPROVAL_SECRET.length >= 43 && env.OAUTH_KV && !(/^true$/i.test(env.ENABLE_WRITES ?? "false")));
}

async function handleRpc(req: JsonRpcRequest, env: Env, apiKey: string): Promise<Response> {
  const { id, method, params } = req;
  if (method.startsWith("notifications/")) return new Response(null, { status: 202 });
  switch (method) {
    case "initialize":
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "mcp-unifi-oauth-readonly", version: "0.2.0" },
      });
    case "ping": return result(id, {});
    case "resources/list": return result(id, { resources: [] });
    case "prompts/list": return result(id, { prompts: [] });
    case "tools/list":
      return result(id, { tools: safeTools(env).map(({ name, description, inputSchema }) => ({
        name, description, inputSchema,
      })) });
    case "tools/call": {
      const name = params?.name;
      const tool = safeTools(env).find((t) => t.name === name);
      if (!tool) return toolFailure(id, `Unknown or disabled tool: ${name}.`);
      try {
        const value = await tool.handler(params?.arguments ?? {}, {
          client: new UnifiClient(apiKey, env), env, apiKey,
        });
        return result(id, { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
      } catch (err) {
        if (err instanceof UnifiError) return toolFailure(id, err.message);
        // Do not reflect potentially sensitive exception internals to remote callers.
        return toolFailure(id, `Unexpected failure in ${name}.`);
      }
    }
    default: return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const noStore = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

function consentHtml(
  info: { clientName: string; clientDomain?: string | null; redirectHost: string; redirectIsLoopback: boolean },
  handle: string,
): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Home UniFi authorization</title></head><body>
<h1>Allow ${escapeHtml(info.clientName)} to read your Home UniFi?</h1>
<p>${info.clientDomain ? `Published by ${escapeHtml(info.clientDomain)}.` : "This application's name is self-declared, not verified."}</p>
<p>OAuth credentials will be delivered to <strong>${escapeHtml(info.redirectHost)}</strong>.</p>
${info.redirectIsLoopback ? "<p><strong>Warning: redirect to a local device. Continue only if you initiated this sign-in.</strong></p>" : ""}
<p>Permission: read-only access to UniFi devices, clients and network configuration. No configuration changes.</p>
<form method="post" action="/authorize">
<input type="hidden" name="handle" value="${escapeHtml(handle)}">
<label>Owner approval secret <input type="password" name="owner_secret" required autocomplete="off"></label>
<button type="submit" name="decision" value="approve">Allow read access</button>
<button type="submit" name="decision" value="deny" formnovalidate>Deny</button>
</form></body></html>`;
}

async function authorize(request: Request, env: Env): Promise<Response> {
  if (!isConfigured(env)) return new Response("OAuth server is not configured.", { status: 503, headers: noStore });
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (request.method === "GET") {
      const authRequest = await oauth.parseAuthRequest(request);
      if (!authRequest.scope.includes(READ_SCOPE)) {
        return new Response("mcp:read scope required.", { status: 400, headers: noStore });
      }
      const details = await oauth.describeConsent(authRequest);
      const consent = await oauth.beginConsent(authRequest);
      consent.headers.set("content-type", "text/html; charset=utf-8");
      consent.headers.set("cache-control", "no-store");
      consent.headers.set("referrer-policy", "no-referrer");
      consent.headers.set("x-frame-options", "DENY");
      // Chrome and Safari apply form-action to cross-origin 302 redirects after POST.
      // Consent POSTs only to this Worker; redirect may go only to ChatGPT.
      consent.headers.set("content-security-policy",
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://chatgpt.com; base-uri 'none'; frame-ancestors 'none'");
      return new Response(consentHtml(details, consent.handle), { headers: consent.headers });
    }
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: noStore });
    // Do not reject solely on the browser's Origin header: external OAuth
    // webviews can supply an opaque "null" origin when submitting the consent form.
    // The official provider's approveConsent()/denyConsent() verify a high-entropy,
    // single-use handle AND its matching browser-bound __Host- cookie instead.
    const form = await request.formData();
    const handle = form.get("handle");
    if (typeof handle !== "string" || !handle) return new Response("Invalid consent", { status: 400, headers: noStore });
    if (form.get("decision") !== "approve") {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    if (!matchesOwnerSecret(form.get("owner_secret"), env.OWNER_APPROVAL_SECRET!)) {
      return new Response("Approval denied.", { status: 403, headers: noStore });
    }
    const approved = await oauth.approveConsent(request, handle, { scope: [READ_SCOPE] });
    if (!approved.request.scope.includes(READ_SCOPE)) {
      return new Response("mcp:read scope required.", { status: 400, headers: noStore });
    }
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request, userId: "owner", metadata: {},
      scope: [READ_SCOPE], props: { userId: "owner" },
    });
    approved.headers.set("Location", redirectTo);
    approved.headers.set("cache-control", "no-store");
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (err) {
    if (err instanceof AuthorizationError && err.redirectTo) return Response.redirect(err.redirectTo, 302);
    if (err instanceof AuthorizationError) return new Response(err.description, { status: 400, headers: noStore });
    // Never reveal OAuth internals or secrets on unexpected exceptions.
    return new Response("Authorization failed.", { status: 400, headers: noStore });
  }
}

const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const auth = ctx as ExecutionContext & { props?: { userId?: string }; auth?: { scope?: string[] } };
    if (!isConfigured(env)) return new Response("Service is not configured.", { status: 503, headers: noStore });
    if (auth.props?.userId !== "owner" || !auth.auth?.scope?.includes(READ_SCOPE)) {
      return new Response("Forbidden.", { status: 403, headers: noStore });
    }
    if (new URL(request.url).pathname !== "/mcp") return new Response("Not found.", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed. POST JSON-RPC to /mcp.", { status: 405 });
    let body: JsonRpcRequest;
    try { body = await request.json() as JsonRpcRequest; }
    catch { return rpcError(null, -32700, "Request body was not valid JSON."); }
    if (body?.jsonrpc !== "2.0" || typeof body.method !== "string") {
      return rpcError(body?.id ?? null, -32600, "Invalid JSON-RPC request.");
    }
    return handleRpc(body, env, env.UNIFI_API_KEY!);
  },
};

const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/health") return new Response("ok", { headers: { "content-type": "text/plain" } });
    if (pathname === "/authorize") return authorize(request, env);
    // Legacy /mcp/t/TOKEN URL fallback is intentionally removed.
    return new Response("Not found", { status: 404 });
  },
};

export default new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: mcpHandler,
  defaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: [READ_SCOPE],
  resourceMetadata: { resource: RESOURCE, authorization_servers: [ORIGIN], resource_name: "Home UniFi read-only" },
  requiredScopes: [READ_SCOPE],
  accessTokenTTL: 3600,
  refreshTokenTTL: 2592000,
});
