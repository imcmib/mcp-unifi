import { test } from "node:test";
import assert from "node:assert/strict";
import { CONSENT_CSP } from "../src/consent-csp.ts";

test("consent form allows the Worker POST and only the ChatGPT callback origin", () => {
  assert.match(CONSENT_CSP, /(?:^|;)\s*form-action 'self' https:\/\/chatgpt\.com;/);
  assert.doesNotMatch(CONSENT_CSP, /form-action[^;]*\*/);
  assert.doesNotMatch(CONSENT_CSP, /form-action[^;]*https:\/\/\*\./);
});

test("consent CSP retains strict script and framing restrictions", () => {
  assert.match(CONSENT_CSP, /default-src 'none';/);
  assert.match(CONSENT_CSP, /frame-ancestors 'none'/);
  assert.match(CONSENT_CSP, /base-uri 'none'/);
});
