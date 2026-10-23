import { test } from "node:test";
import assert from "node:assert/strict";
import { lowCallWarning } from "../src/subscriptions.mjs";

const plan = (remaining, total, status = "active") => ({ status, calls_remaining: remaining, calls_total: total });

test("warns at 10% or less of the calls remaining", () => {
  assert.deepEqual(lowCallWarning(plan(3, 30)), { remaining: 3, total: 30 });
  assert.deepEqual(lowCallWarning(plan(1, 30)), { remaining: 1, total: 30 });
});

test("stays quiet above 10%, when exhausted, unlimited, inactive or a single-call plan", () => {
  assert.equal(lowCallWarning(plan(4, 30)), null);
  assert.equal(lowCallWarning(plan(0, 30)), null);
  assert.equal(lowCallWarning(plan(null, null)), null);
  assert.equal(lowCallWarning(plan(3, 30, "expired")), null);
  assert.equal(lowCallWarning(plan(1, 1)), null);
  assert.equal(lowCallWarning(null), null);
});
