const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { createRequire } = require("node:module");
const mainPath = path.resolve(__dirname, "../main.js");
const sender = (window) => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
const mainRequire = createRequire(mainPath);

async function boot({
  platform = "win32",
  release = "10.0.22631",
  env = {},
  isPackaged = false,
  metadata = {},
  healthStatus = 200,
  healthError,
  healthBody = { status: "ok", service: "api-fastapi" },
  sources = [{ id: "screen:0" }],
  sourceError,
} = {}) {
  const handlers = new Map();
  const windows = [];
  const app = new EventEmitter();
  app.whenReady = () => Promise.resolve();
  app.isPackaged = isPackaged;
  app.commandLine = { appendSwitch() {} };
  app.quit = () => { app.didQuit = true; };
  app.getPath = () => fs.mkdtempSync(path.join(require("node:os").tmpdir(), "techprep-test-"));
  app.getVersion = () => "0.0.0-test";
  const errors = [];
  const healthRequests = [];
  const permissions = {};
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = {};
      this.calls = [];
      windows.push(this);
    }
    setContentProtection(value) { this.calls.push(value); }
    setAlwaysOnTop() {}
    setSkipTaskbar(value) { this.skipTaskbarCalls ??= []; this.skipTaskbarCalls.push(value); }
    isDestroyed() { return false; }
    loadURL(url) { this.url = url; return Promise.resolve(); }
    show() { this.shown = true; }
    close() { this.closedByApp = true; this.emit("closed"); }
  }
  const electron = {
    app, BrowserWindow: Window,
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    session: { defaultSession: {
      clearCache: async () => {},
      setPermissionRequestHandler(handler) { permissions.request = handler; },
      setDisplayMediaRequestHandler(handler) { permissions.display = handler; },
    } },
    desktopCapturer: { async getSources() {
      if (sourceError) throw sourceError;
      return sources;
    } },
    dialog: { showErrorBox: (...args) => errors.push(args) },
    net: { async fetch(url, options) {
      healthRequests.push({ url, options });
      if (healthError) throw healthError;
      return { status: healthStatus, json: async () => healthBody };
    } },
  };
  vm.runInNewContext(fs.readFileSync(mainPath, "utf8"), {
    require(name) {
      if (name === "electron") return electron;
      if (name === "./package.json") return metadata;
      if (name === "os") return { release: () => release };
      if (name === "child_process") return { spawn: assert.fail, execFileSync: assert.fail };
      return mainRequire(name);
    },
    process: { platform, env, versions: { electron: "44.7.1" }, on() {} },
    __dirname: path.dirname(mainPath), console, setTimeout, URL, AbortSignal,
  });
  await new Promise(setImmediate);
  return { app, handlers, windows, errors, healthRequests, permissions };
}

test("remote HTTPS checks the configured server using Chromium certificate trust", async () => {
  const { healthRequests, windows, errors } = await boot({ env: { APP_URL: "https://172.168.20.55:5173/" } });
  assert.equal(healthRequests[0].url, "https://172.168.20.55:5173/health");
  assert.equal(healthRequests[0].options.redirect, "error");
  assert.ok(healthRequests[0].options.signal instanceof AbortSignal);
  assert.equal(windows[0].url, "https://172.168.20.55:5173/?login=1");
  assert.deepEqual(errors, []);
});

test("default desktop startup still checks the local backend", async () => {
  const { healthRequests } = await boot();
  assert.equal(healthRequests[0].url, "http://127.0.0.1:8000/health");
});

test("installed desktop opens its embedded HTTPS server without environment variables", async () => {
  const { healthRequests, windows, errors } = await boot({
    isPackaged: true, metadata: { techprepServerUrl: "https://192.168.0.109:5173/" },
  });
  assert.equal(healthRequests[0].url, "https://192.168.0.109:5173/health");
  assert.equal(windows[0].url, "https://192.168.0.109:5173/?login=1");
  assert.deepEqual(errors, []);
});

test("APP_URL overrides the installed server metadata", async () => {
  const { healthRequests } = await boot({
    isPackaged: true,
    metadata: { techprepServerUrl: "https://192.168.0.109:5173/" },
    env: { APP_URL: "https://other-server.example/" },
  });
  assert.equal(healthRequests[0].url, "https://other-server.example/health");
});

test("offline, invalid-certificate, and unsuccessful health responses stop startup with an actionable error", async () => {
  for (const failure of [
    { healthError: new Error("net::ERR_CONNECTION_REFUSED") },
    { healthError: new Error("net::ERR_CERT_AUTHORITY_INVALID") },
    { healthStatus: 503 },
    { healthBody: { status: "ok", service: "another-app" } },
  ]) {
    const { windows, app, errors } = await boot({ env: { APP_URL: "https://172.168.20.55:5173/" }, ...failure });
    assert.equal(windows.length, 0);
    assert.equal(app.didQuit, true);
    assert.equal(errors[0][0], "Cannot connect to TechPrep");
    assert.match(errors[0][1], /https:\/\/172\.168\.20\.55:5173\/health/);
    assert.match(errors[0][1], /Trusted Root Certification Authorities/);
  }
});

test("Windows overlay gets loopback audio without the browser source picker", async () => {
  const boot1 = await boot({ env: { APP_URL: "https://172.168.20.55:5173/" } });
  const window = signIn(boot1);
  let selection;
  await boot1.permissions.display({
    frame: window.webContents.mainFrame, securityOrigin: "https://172.168.20.55:5173", audioRequested: true,
  }, (value) => { selection = value; });
  assert.equal(selection.video.id, "screen:0");
  assert.equal(selection.audio, "loopback");
  let allowed;
  const request = (frame, url, permission) => boot1.permissions.request(window.webContents, permission,
    (value) => { allowed = value; }, { isMainFrame: frame, requestingUrl: url });
  request(true, window.url, "media");
  assert.equal(allowed, true);
  request(false, window.url, "media");
  assert.equal(allowed, false);
  request(true, "https://another-origin.example/", "media");
  assert.equal(allowed, false);
  request(true, window.url, "notifications");
  assert.equal(allowed, false);
});

test("macOS overlay requests loopback audio without the browser source picker", async () => {
  const boot1 = await boot({
    platform: "darwin",
    release: "24.0.0",
    env: { APP_URL: "https://172.168.20.55:5173/" },
  });
  const window = signIn(boot1);
  let selection;
  await boot1.permissions.display({
    frame: window.webContents.mainFrame, securityOrigin: "https://172.168.20.55:5173", audioRequested: true,
  }, (value) => { selection = value; });
  assert.equal(selection.video.id, "screen:0");
  assert.equal(selection.audio, "loopback");
});

test("display capture denies other frames/origins and reports unavailable sources through denial", async () => {
  const boot1 = await boot();
  const window = signIn(boot1);
  const good = { frame: window.webContents.mainFrame, securityOrigin: "http://127.0.0.1:8000", audioRequested: true };
  for (const request of [{ ...good, frame: {} }, { ...good, securityOrigin: "https://elsewhere.example" }, { ...good, audioRequested: false }]) {
    await boot1.permissions.display(request, (value) => assert.equal(Object.keys(value).length, 0));
  }
  for (const unavailable of [{ sources: [] }, { sourceError: new Error("capture unavailable") }]) {
    const boot2 = await boot(unavailable);
    const overlay = signIn(boot2);
    await boot2.permissions.display({ ...good, frame: overlay.webContents.mainFrame },
      (value) => assert.equal(Object.keys(value).length, 0));
  }
});

function signIn({ handlers, windows }) {
  handlers.get("login-succeeded")(sender(windows.at(-1)));
  return windows.at(-1);
}

test("the first window is the login window, and the overlay opens only after sign-in", async () => {
  const boot1 = await boot();
  const { handlers, windows } = boot1;
  assert.equal(windows.length, 1);
  assert.match(windows[0].url, /\?login=1$/);
  assert.equal(windows[0].options.transparent, undefined);
  const login = windows[0];
  const overlay = signIn(boot1);
  assert.equal(windows.length, 2);
  assert.equal(overlay.options.transparent, true);
  assert.equal(overlay.options.alwaysOnTop, true);
  assert.equal(overlay.options.skipTaskbar, true);
  assert.equal(login.options.skipTaskbar, undefined);
  assert.deepEqual(overlay.skipTaskbarCalls, [true]);
  overlay.emit("ready-to-show");
  handlers.get("initialize-content-protection")(sender(overlay), true);
  assert.deepEqual(overlay.skipTaskbarCalls, [true, true]);
  assert.equal(login.closedByApp, true);
  assert.throws(() => handlers.get("login-succeeded")(sender(overlay)), /Only the login window/);
});

test("login and sign-out IPC reject unrelated senders", async () => {
  const { handlers, windows } = await boot();
  assert.throws(() => handlers.get("login-succeeded")({ sender: {}, senderFrame: {} }), /Only the login window/);
  assert.throws(() => handlers.get("login-succeeded")({ sender: windows[0].webContents, senderFrame: {} }), /Only the login window/);
  assert.throws(() => handlers.get("sign-out")(sender(windows[0])), /Only the overlay/);
});

test("sign-out closes the overlay and returns to login; signing in again reapplies protection", async () => {
  const boot1 = await boot();
  const { app, handlers, windows } = boot1;
  const first = signIn(boot1);
  first.emit("ready-to-show");
  assert.equal(handlers.get("initialize-content-protection")(sender(first), true).status, "enabled");
  assert.equal(first.shown, true);
  assert.deepEqual(first.calls, [false, true]);
  handlers.get("sign-out")(sender(first));
  assert.equal(windows.length, 3);
  assert.match(windows[2].url, /\?login=1$/);
  assert.equal(first.closedByApp, true);
  const second = signIn(boot1);
  assert.deepEqual(second.calls, [true]);
  first.emit("closed"); // a stale close event must not drop the current overlay
  app.emit("activate");
  assert.equal(windows.length, 4);
  second.emit("closed");
  app.emit("activate");
  assert.equal(windows.length, 5);
  assert.match(windows[4].url, /\?login=1$/);
});

test("capture IPC rejects other windows, subframes and non-boolean requests", async () => {
  const boot1 = await boot();
  const { handlers } = boot1;
  const window = signIn(boot1);
  for (const name of ["initialize-content-protection", "get-content-protection", "set-content-protection"]) {
    assert.throws(() => handlers.get(name)({ sender: {}, senderFrame: {} }, true), /only available for the overlay/);
    assert.throws(() => handlers.get(name)({ sender: window.webContents, senderFrame: {} }, true), /only available for the overlay/);
  }
  assert.throws(() => handlers.get("set-content-protection")(sender(window), "true"), /boolean/);
  assert.throws(() => handlers.get("initialize-content-protection")(sender(window), null), /boolean/);
});

test("preload retains existing controls and exposes narrow capture IPC methods", async () => {
  let exposed;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../preload.js"), "utf8"), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, "desktop"); exposed = value; } },
      ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve(); } },
    }),
    process: { platform: "win32", env: {} },
  });
  await exposed.initializeContentProtection(true);
  await exposed.getContentProtection();
  await exposed.setContentProtection(false);
  assert.deepEqual(calls, [
    ["initialize-content-protection", true], ["get-content-protection"], ["set-content-protection", false],
  ]);
  await exposed.loginSucceeded();
  await exposed.signOut();
  assert.deepEqual(calls.slice(-2), [["login-succeeded"], ["sign-out"]]);
  for (const name of ["setAlwaysOnTop", "minimize", "close", "openExternal"]) assert.equal(typeof exposed[name], "function");
});
