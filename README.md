# Home UniFi — ChatGPT OAuth read-only fork

A Cloudflare Worker MCP server using UniFi Site Manager's **Cloud Connector**.
No home server, phone VPN relay, or inbound router ports required.

This branch replaces the upstream static-token MCP endpoint with an OAuth 2.1
authorization-code + PKCE flow implemented by
[`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider).
It is intended for a **single owner**, not for public multi-user access.

> **DRAFT: Do not merge or deploy before the checklist below is complete.**
> The KV namespace ID is intentionally a placeholder and the Worker will not be
> ready until it is replaced. Cloudflare's existing main deployment stays unchanged.

## Security properties

- `UNIFI_API_KEY` stays in Cloudflare Secrets, not in source, the OAuth token, or ChatGPT.
- `OWNER_APPROVAL_SECRET` is **independent** of the UniFi key and legacy `MCP_TOKEN`.
- The owner's secret is entered on the HTTPS authorization/consent form; never in this
  repository or a chat message. Use a new random 32-byte / 64-hex secret.
- OAuth tokens, grants and registered clients are managed by the Cloudflare library in KV.
- Consent displays the requested client's identity and its token redirect destination.
  Approve only the ChatGPT flow you initiated; client display names are not proof of identity.
- Only `mcp:read` is granted. `raw_request` (the arbitrary proxy escape hatch) and
  `apply_config` are excluded from the advertised AND executable tools.
- Setting `ENABLE_WRITES=true` fails closed. Do not change it.
- The old `/mcp/t/TOKEN` URL credential fallback is removed.
- No static `MCP_TOKEN` authentication on `/mcp`: OAuth bearer tokens only.
- `/health` reports only the Worker process status, not UniFi availability.
- Strongly recommend a Cloudflare WAF rate-limiting rule on `/authorize` for
  invalid owner-secret attempts. Keep access logs free of request bodies.

## Configure before deploying

1. Check that your UniFi console supports Cloud Connector (UniFi OS 5.0.3+), and
   generate a Site Manager API key at https://unifi.ui.com. A console-local key
   is not interchangeable with a Site Manager key.
2. In Cloudflare Dashboard -> Workers & Pages -> KV, create a namespace
   called `home-unifi-oauth`. Copy its **namespace ID** (not a secret).
3. On this branch, replace `REPLACE_WITH_REAL_KV_NAMESPACE_ID` in
   `wrangler.toml` with that ID. The binding must be named `OAUTH_KV`.
4. Under the Worker -> Settings -> Variables and Secrets, add as **Secret**:
   - `UNIFI_API_KEY`: your Site Manager API key.
   - `OWNER_APPROVAL_SECRET`: a **new**, independent, random 64-character
     hexadecimal string. This is the credential to type on the consent page.
   - Optional: `ALLOWED_CONSOLES`: comma-separated console IDs to restrict access.
5. Keep `ENABLE_WRITES="false"`. You may delete the unused legacy `MCP_TOKEN`
   **after switching to this OAuth branch**, not before.
6. Turn off Preview builds or protect them separately: do not deploy public
   preview environments with production secrets.
7. Deploy only after reviewing the branch/PR. The public MCP resource is
   `https://mcp-unifi.imcmib.workers.dev/mcp`. If changing that hostname,
   update `ORIGIN` in `src/index.ts` and deploy before configuring ChatGPT.
8. Restrict any GitHub->Cloudflare auto-deploy to merged `main`, not draft branches.

## Local checks (no real secrets needed)

```bash
npm install
npm run check
```

After authorized deployment:
- `GET /health` -> `ok` (not a UniFi API check).
- `GET /mcp` or `POST /mcp` with no OAuth bearer token -> OAuth 401 challenge.
- `GET /.well-known/oauth-protected-resource/mcp` -> discovery metadata.
- `GET /.well-known/oauth-authorization-server` -> OAuth metadata.
- `POST /mcp` with an OAuth token: run `initialize`, then `tools/list`. Verify
  `raw_request` and `apply_config` are absent; `list_consoles` should be present.
- Authorize only an OAuth client you deliberately connected, and inspect the
  redirect hostname on the owner-consent page before typing the approval secret.
- Test `list_consoles` first; then `fleet_health` and `list_devices`. A healthy
  `/health` alone never proves UniFi credentials or Cloud Connector are working.

## Connect in ChatGPT

Open ChatGPT web -> Plugins -> create a custom MCP connection. Use the remote
endpoint `https://mcp-unifi.imcmib.workers.dev/mcp`, OAuth, and complete the
owner approval in the browser. Do **not** choose No authentication. Compatibility
depends on the current ChatGPT workspace's MCP/OAuth settings.

## Read-only tools

- `list_consoles`, `verify_console`, `get_config`, `diff_config`,
  `fleet_health`, `get_health`, `list_devices`, `list_clients`,
  `fleet_inventory`, `firmware_report`.
- There is intentionally no arbitrary proxy tool in the accessible MCP surface.

The upstream tool implementation stays the same for these named read actions.
See the original upstream repository for UniFi API details and licensing.

## Limitations

- The authorization form uses a strong owner-held secret instead of third-party
  sign-in. Rotate `OWNER_APPROVAL_SECRET` if it leaks; note that changing it
  controls **future approval**, and does not revoke existing OAuth grants.
  Revoke grants/tokens in OAuth KV or recreate the namespace to invalidate
  existing sessions (this also clears registrations).
- Cloudflare KV is eventually consistent. For higher assurance and abuse protection,
  add provider identity login and WAF rate limiting before multi-user use.
- The Worker is designed for a single explicitly trusted owner, and is not a
  general-purpose identity provider.

## License

MIT, derived from the upstream `mcp-unifi` project.
