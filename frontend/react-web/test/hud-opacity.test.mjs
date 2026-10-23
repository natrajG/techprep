import assert from "node:assert/strict";
import { test } from "node:test";
import { clampHudOpacity, MIN_HUD_OPACITY, DEFAULT_HUD_OPACITY } from "../src/hud-opacity.mjs";

test("saved values below the readable floor are raised", () => {
  assert.equal(clampHudOpacity("0.2"), MIN_HUD_OPACITY);
  assert.equal(clampHudOpacity(0), MIN_HUD_OPACITY);
  assert.equal(clampHudOpacity(-1), MIN_HUD_OPACITY);
});

test("valid values are kept and the upper bound is 1", () => {
  assert.equal(clampHudOpacity("0.85"), 0.85);
  assert.equal(clampHudOpacity(1), 1);
  assert.equal(clampHudOpacity(3), 1);
});

test("missing or corrupt values fall back to the default", () => {
  assert.equal(clampHudOpacity(undefined), DEFAULT_HUD_OPACITY);
  assert.equal(clampHudOpacity("abc"), DEFAULT_HUD_OPACITY);
  assert.equal(clampHudOpacity(Infinity), DEFAULT_HUD_OPACITY);
});
