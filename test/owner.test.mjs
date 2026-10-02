import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesOwnerSecret } from "../src/owner.ts";

const ownerSecret = "a".repeat(64);

test("valid owner secret is accepted", () => {
  assert.equal(matchesOwnerSecret(ownerSecret, ownerSecret), true);
});
test("wrong, missing, short and oversized credentials are denied", () => {
  assert.equal(matchesOwnerSecret("b".repeat(64), ownerSecret), false);
  assert.equal(matchesOwnerSecret(null, ownerSecret), false);
  assert.equal(matchesOwnerSecret(ownerSecret, "short"), false);
  assert.equal(matchesOwnerSecret("a".repeat(4097), ownerSecret), false);
});
test("prefix and suffix cannot authenticate", () => {
  assert.equal(matchesOwnerSecret(ownerSecret.slice(0, -1), ownerSecret), false);
  assert.equal(matchesOwnerSecret(ownerSecret + "x", ownerSecret), false);
});
