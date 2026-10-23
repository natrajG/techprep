const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { detectCapability, createCaptureProtection } = require("../capture-protection");
const { createOverlayWindow } = require("../overlay-window");

const windows = { platform: "win32", release: "10.0.19041", electronVersion: "44.7.1" };
const mac = { platform: "darwin", release: "22.6.0", electronVersion: "44.7.1" };
const silentLogger = { error() {} };

class MockWindow extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.calls = [];
    this.destroyed = false;
    this.webContents = new EventEmitter();
  }
  setContentProtection(value) {
    this.calls.push(["protection", value]);
    if (this.failure) throw new Error(this.failure);
  }
  isDestroyed() { return this.destroyed; }
  setAlwaysOnTop(...args) { this.calls.push(["top", ...args]); }
  setSkipTaskbar(...args) { this.calls.push(["skipTaskbar", ...args]); }
  loadURL(url) { this.calls.push(["load", url]); return Promise.resolve(); }
  show() { this.calls.push(["show"]); }
}

for (const [name, environment, supported, mechanism] of [
  ["Windows 10 2004", windows, true, "WDA_EXCLUDEFROMCAPTURE"],
  ["Windows 11", { ...windows, release: "10.0.22631" }, true, "WDA_EXCLUDEFROMCAPTURE"],
  ["older Windows 10", { ...windows, release: "10.0.18363" }, true, "WDA_MONITOR"],
  ["Windows 8.1", { ...windows, release: "6.3.9600" }, false, "none"],
  ["unknown Windows version", { ...windows, release: "unknown" }, false, "none"],
  ["macOS 13", mac, true, "NSWindowSharingNone"],
  ["macOS 12", { ...mac, release: "21.6.0" }, false, "none"],
  ["macOS 15", { ...mac, release: "24.0.0" }, true, "NSWindowSharingNone"],
  ["macOS 10.15", { ...mac, release: "19.6.0" }, false, "none"],
  ["unknown macOS version", { ...mac, release: "" }, false, "none"],
  ["Linux", { ...windows, platform: "linux" }, false, "none"],
  ["other platforms", { ...windows, platform: "freebsd" }, false, "none"],
  ["Electron below project minimum", { ...windows, electronVersion: "43.0.0" }, false, "none"],
  ["unknown Electron version", { ...windows, electronVersion: "" }, false, "none"],
]) {
  test(`capability: ${name}`, () => {
    const result = detectCapability({ ...environment, apiAvailable: true });
    assert.equal(result.supported, supported);
    assert.equal(result.mechanism, mechanism);
    assert.ok(result.detail);
  });
}

test("missing Electron API is unsupported", () => {
  assert.equal(detectCapability({ ...windows, apiAvailable: false }).supported, false);
});

for (const environment of [windows, mac]) {
  test(`enable, disable and reattach: ${environment.platform}`, () => {
    const protection = createCaptureProtection(environment);
    const first = new MockWindow();
    assert.equal(protection.attach(first).status, "disabled");
    assert.equal(protection.setRequested(true).status, "enabled");
    const second = new MockWindow();
    assert.equal(protection.attach(second).requested, true);
    assert.deepEqual(second.calls, [["protection", true]]);
    const state = protection.setRequested(false);
    assert.equal(state.status, "disabled");
    assert.equal(state.enabled, false);
    assert.equal(state.requested, false);
    assert.deepEqual(first.calls, [["protection", false], ["protection", true]]);
  });
}

test("Linux never calls the native API and preserves intent", () => {
  const protection = createCaptureProtection({ ...windows, platform: "linux" });
  const window = new MockWindow();
  protection.attach(window);
  const state = protection.setRequested(true);
  assert.equal(state.requested, true);
  assert.equal(state.enabled, false);
  assert.equal(state.status, "unsupported");
  assert.deepEqual(window.calls, []);
});

test("native errors are reported, preserve preference, and allow retry", () => {
  const errors = [];
  const protection = createCaptureProtection(windows, { error: (...args) => errors.push(args) });
  const window = new MockWindow();
  window.failure = "Native request rejected";
  assert.equal(protection.attach(window).status, "failed");
  const state = protection.setRequested(true);
  assert.equal(state.status, "failed");
  assert.equal(state.enabled, false);
  assert.equal(state.requested, true);
  assert.equal(state.error, "Native request rejected");
  assert.equal(errors.length, 2);
  window.failure = null;
  assert.equal(protection.setRequested(true).status, "enabled");
  window.failure = "Cannot disable";
  const failedDisable = protection.setRequested(false);
  assert.equal(failedDisable.status, "failed");
  assert.equal(failedDisable.requested, false);
});

test("destroyed windows fail without invoking a native method", () => {
  const protection = createCaptureProtection(windows, silentLogger);
  const window = new MockWindow();
  protection.attach(window);
  window.destroyed = true;
  assert.equal(protection.setRequested(true).status, "failed");
  assert.equal(window.calls.length, 1);
});

test("invalid requests are rejected and state snapshots cannot mutate intent", () => {
  const protection = createCaptureProtection(windows);
  protection.attach(new MockWindow());
  assert.throws(() => protection.setRequested("true"), TypeError);
  const state = protection.getState();
  state.requested = true;
  assert.equal(protection.getState().requested, false);
});

for (const readyFirst of [true, false]) {
  test(`overlay stays hidden until both native restoration and readiness (readyFirst=${readyFirst})`, () => {
    const protection = createCaptureProtection(windows);
    const overlay = createOverlayWindow({
      BrowserWindow: MockWindow, protection, preload: "/preload.js", url: "http://localhost/",
      onLoadError: assert.fail,
    });
    assert.equal(overlay.window.options.show, false);
    assert.equal(overlay.window.options.transparent, true);
    assert.equal(overlay.window.options.frame, false);
    assert.equal(overlay.window.options.minWidth, 320);
    assert.deepEqual(overlay.window.calls.slice(0, 4), [
      ["top", true, "floating"], ["skipTaskbar", true], ["protection", false], ["load", "http://localhost/"],
    ]);
    if (readyFirst) overlay.window.emit("ready-to-show");
    else overlay.restore(true);
    assert.ok(!overlay.window.calls.some(([name]) => name === "show"));
    if (readyFirst) overlay.restore(true);
    else overlay.window.emit("ready-to-show");
    assert.deepEqual(overlay.window.calls.slice(-3), [["protection", true], ["show"], ["skipTaskbar", true]]);
    overlay.restore(true);
    assert.equal(overlay.window.calls.filter(([name]) => name === "show").length, 1);
  });
}

test("recreated overlays apply cached preference before loading, then restore storage again", () => {
  const protection = createCaptureProtection(mac);
  const options = { BrowserWindow: MockWindow, protection, preload: "/preload.js", url: "http://localhost/", onLoadError: assert.fail };
  const first = createOverlayWindow(options);
  first.restore(true);
  first.window.destroyed = true;
  first.window.emit("closed");
  const second = createOverlayWindow(options);
  assert.deepEqual(second.window.calls[2], ["protection", true]);
  second.restore(false);
  second.window.emit("ready-to-show");
  assert.equal(protection.getState().status, "disabled");
});

test("unsupported and failed protection still allow the UI to show its explanation", () => {
  for (const environment of [windows, { ...windows, platform: "linux" }]) {
    class FailedWindow extends MockWindow {
      constructor(options) { super(options); this.failure = "Rejected"; }
    }
    const protection = createCaptureProtection(environment, silentLogger);
    const overlay = createOverlayWindow({
      BrowserWindow: FailedWindow, protection, preload: "/preload.js", url: "http://localhost/", onLoadError: assert.fail,
    });
    overlay.window.emit("ready-to-show");
    assert.equal(overlay.restore(true).enabled, false);
    assert.deepEqual(overlay.window.calls.slice(-2), [["show"], ["skipTaskbar", true]]);
  }
});

test("page load failures are surfaced", async () => {
  class FailedLoadWindow extends MockWindow {
    loadURL() { return Promise.reject(new Error("Backend unavailable")); }
  }
  let error;
  createOverlayWindow({
    BrowserWindow: FailedLoadWindow, protection: createCaptureProtection(windows),
    preload: "/preload.js", url: "http://localhost/", onLoadError: (value) => { error = value; },
  });
  await Promise.resolve();
  assert.equal(error.message, "Backend unavailable");
});

test("renderer initialization timeout surfaces an error instead of showing uninitialized content", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let error;
  const overlay = createOverlayWindow({
    BrowserWindow: MockWindow, protection: createCaptureProtection(windows),
    preload: "/preload.js", url: "http://localhost/", onLoadError: (value) => { error = value; },
  });
  overlay.window.emit("ready-to-show");
  overlay.window.webContents.emit("did-finish-load");
  context.mock.timers.tick(15000);
  assert.match(error.message, /did not restore/);
  assert.ok(!overlay.window.calls.some(([name]) => name === "show"));
});

test("restoring or closing the window cancels its initialization timeout", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  for (const restore of [true, false]) {
    const overlay = createOverlayWindow({
      BrowserWindow: MockWindow, protection: createCaptureProtection(windows),
      preload: "/preload.js", url: "http://localhost/", onLoadError: assert.fail,
    });
    overlay.window.webContents.emit("did-finish-load");
    if (restore) overlay.restore(true);
    else overlay.window.emit("closed");
    context.mock.timers.tick(15000);
  }
});
