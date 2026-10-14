const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createCaptureProtection } = require("../capture-protection");
const renderer = import("../../frontend/react-web/src/capture-protection.mjs");

function storage(initial = null) {
  const values = new Map(initial === null ? [] : [["captureProtection", initial]]);
  values.set("resume", "Keep my resume");
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function bridge(platform = "win32", failure = false) {
  const release = platform === "darwin" ? "24.0.0" : "10.0.22631";
  const controller = createCaptureProtection({
    platform, release, electronVersion: "44.7.1",
  }, { error() {} });
  controller.attach({
    isDestroyed: () => false,
    setContentProtection: () => { if (failure) throw new Error("Native failure"); },
  });
  return {
    platform,
    initializeContentProtection: async (value) => controller.setRequested(value),
    setContentProtection: async (value) => controller.setRequested(value),
  };
}

test("Windows/macOS default capture protection on, persists both settings, and restores across app restarts", async () => {
  const { restoreCaptureProtection, changeCaptureProtection } = await renderer;
  const saved = storage();
  assert.equal((await restoreCaptureProtection(bridge("win32"), saved)).state.status, "enabled");
  assert.equal((await restoreCaptureProtection(bridge("darwin"), storage())).state.status, "enabled");
  assert.equal((await changeCaptureProtection(bridge(), saved, true)).status, "enabled");
  assert.equal(saved.getItem("captureProtection"), "true");
  assert.equal((await restoreCaptureProtection(bridge(), saved)).state.requested, true);
  await changeCaptureProtection(bridge(), saved, false);
  assert.equal(saved.getItem("captureProtection"), "false");
  assert.equal((await restoreCaptureProtection(bridge(), saved)).state.status, "disabled");
  assert.equal(saved.getItem("resume"), "Keep my resume");
});

test("Linux defaults capture protection off", async () => {
  const { restoreCaptureProtection } = await renderer;
  const { state } = await restoreCaptureProtection(bridge("linux"), storage());
  assert.equal(state.requested, false);
});

test("unsupported platforms restore intent without claiming protection", async () => {
  const { restoreCaptureProtection } = await renderer;
  const { state } = await restoreCaptureProtection(bridge("linux"), storage("true"));
  assert.equal(state.requested, true);
  assert.equal(state.enabled, false);
  assert.equal(state.status, "unsupported");
});

test("failed native requests remain saved for retry", async () => {
  const { changeCaptureProtection, restoreCaptureProtection } = await renderer;
  const saved = storage();
  const state = await changeCaptureProtection(bridge("win32", true), saved, true);
  assert.equal(state.status, "failed");
  assert.equal(saved.getItem("captureProtection"), "true");
  assert.equal((await restoreCaptureProtection(bridge(), saved)).state.status, "enabled");
});

test("corrupt and unavailable storage are explicitly reported while allowing the overlay to initialize", async () => {
  const { restoreCaptureProtection } = await renderer;
  for (const [desktop, expected] of [
    [bridge("win32"), true],
    [bridge("darwin"), true],
    [bridge("linux"), false],
  ]) {
    for (const saved of [storage("invalid"), { getItem() { throw new Error("Storage denied"); } }]) {
      const result = await restoreCaptureProtection(desktop, saved);
      assert.equal(result.state.requested, expected);
      assert.match(result.error, new RegExp(`Cannot restore capture preference; requesting ${expected ? "on" : "off"}`));
    }
  }
});

test("failed preference writes do not call native APIs", async () => {
  const { changeCaptureProtection } = await renderer;
  await assert.rejects(changeCaptureProtection(
    { setContentProtection: assert.fail },
    { setItem() { throw new Error("Quota exceeded"); } }, true,
  ), /Quota exceeded/);
});

test("IPC failures propagate, without erasing saved intent", async () => {
  const { changeCaptureProtection, restoreCaptureProtection } = await renderer;
  const saved = storage();
  const desktop = {
    initializeContentProtection: async () => { throw new Error("IPC unavailable"); },
    setContentProtection: async () => { throw new Error("IPC unavailable"); },
  };
  await assert.rejects(changeCaptureProtection(desktop, saved, true), /IPC unavailable/);
  assert.equal(saved.getItem("captureProtection"), "true");
  await assert.rejects(restoreCaptureProtection(desktop, saved), /IPC unavailable/);
});

test("UI messages distinguish request acceptance, disabled, unsupported, failed and loading", async () => {
  const { captureStatusMessage } = await renderer;
  const detail = "Platform-specific explanation.";
  assert.match(captureStatusMessage({ status: "enabled", detail }), /does not prove recordings are blocked/);
  assert.match(captureStatusMessage({ status: "disabled", detail }), /Disabled by you/);
  assert.match(captureStatusMessage({ status: "unsupported", detail }), /No protection was applied/);
  for (const requested of [true, false]) {
    const message = captureStatusMessage({ status: "failed", requested, error: "Native failure" });
    assert.match(message, /Native failure/);
    assert.match(message, /Actual capture behavior is unknown/);
    assert.ok(message.includes(`remains ${requested ? "on" : "off"}`));
  }
  assert.match(captureStatusMessage({}), /Reading/);
});

test("UI explains Windows fallback and macOS ScreenCaptureKit limitations", async () => {
  const { captureStatusMessage } = await renderer;
  const { detectCapability } = require("../capture-protection");
  const capability = (platform, release) => detectCapability({
    platform, release, apiAvailable: true, electronVersion: "44.7.1",
  });
  assert.match(captureStatusMessage({ ...capability("win32", "10.0.18363"), status: "enabled" }), /blank\/black/);
  assert.match(captureStatusMessage({ ...capability("darwin", "24.0.0"), status: "enabled" }), /ScreenCaptureKit/);
  assert.match(captureStatusMessage({ ...capability("linux", "6.8.0"), status: "unsupported" }), /unsupported on Linux/);
});
