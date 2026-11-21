import { test } from "node:test";
import assert from "node:assert/strict";
import { isAcknowledgement } from "../src/speech-filter.mjs";

test("ignores acknowledgements with known account-name parts", () => {
  for (const text of ["Natraj, thanks.", "Thanks Natraj", "OK", "Yeah, Natraj, please.", "Okay, thanks, Natraj Gudimalla."]) {
    assert.equal(isAcknowledgement(text, "natraj.gudimalla2"), true, text);
  }
  assert.equal(isAcknowledgement("Thanks, Alex.", "alex.smith@example.com"), true);
  assert.equal(isAcknowledgement("Thanks", null), true);
});

test("never strips an unknown topic as a name or discards a real request", () => {
  for (const text of [
    "Thanks Natraj, explain middleware", "Okay, why?", "Natraj, write a Python function",
    "Okay, Redis clustering", "Explain the observer pattern", "", "Natraj",
  ]) {
    assert.equal(isAcknowledgement(text, "natraj.gudimalla2"), false, text);
  }
});
