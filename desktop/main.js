// Desktop shell: a frameless, transparent, optionally always-on-top window that hosts the web UI.
// It runs independently of any browser tab; capture protection is platform-dependent.
const { app, BrowserWindow, ipcMain, session, desktopCapturer, dialog, net, shell } = require("electron");
const { spawn, execFileSync } = require("child_process");
const path = require("path");
const os = require("os");
const { createCaptureProtection } = require("./capture-protection");
const { createOverlayWindow } = require("./overlay-window");
const { resolveAppUrl } = require("./server-url");

if (process.platform === "linux") app.commandLine.appendSwitch("ozone-platform", "x11");

// Linux: Chromium hides PulseAudio "monitor" sources, so route the app's default audio input to the
// monitor of the current output device (= what you hear). Set AUDIO_SOURCE=mic to use the microphone.
function resolveSystemAudioSource() {
  if (process.platform !== "linux" || process.env.PULSE_SOURCE || process.env.AUDIO_SOURCE === "mic") return;
  try {
    const sink = execFileSync("pactl", ["get-default-sink"], { encoding: "utf8" }).trim();
    if (sink) process.env.PULSE_SOURCE = `${sink}.monitor`;
  } catch {
    console.warn("pactl not available; using the default microphone for audio capture.");
  }
}
resolveSystemAudioSource();

const API_PORT = process.env.PORT || "8000";
const APP_URL = resolveAppUrl({ isPackaged: app.isPackaged, env: process.env, metadata: require("./package.json") });
const APP_ORIGIN = new URL(APP_URL).origin;
const HEALTH_URL = new URL("/health", APP_URL).href;
let backend = null;
let win = null;
let overlay = null;
let loginWin = null;
const protection = createCaptureProtection({
  platform: process.platform,
  release: os.release(),
  electronVersion: process.versions.electron,
});

async function checkBackend() {
  // Chromium's network stack uses the same certificate trust as the app window.
  const response = await net.fetch(HEALTH_URL, { signal: AbortSignal.timeout(5000), redirect: "error" });
  if (response.status !== 200) throw new Error(`Backend health returned HTTP ${response.status}.`);
  const health = await response.json();
  if (health.status !== "ok" || health.service !== "api-fastapi") {
    throw new Error("The server did not return a TechPrep health response.");
  }
}

async function ensureBackend() {
  try {
    await checkBackend();
    return;
  } catch (error) {
    if (process.env.APP_URL || app.isPackaged || process.platform !== "linux") {
      throw new Error(
        `Cannot reach TechPrep at ${HEALTH_URL}.\n` +
        "Keep the server running and check network/firewall access. For local HTTPS, import ca.crt " +
        "into Windows Trusted Root Certification Authorities (Current User), then relaunch.\n" +
        `Connection error: ${error.message}`
      );
    }
  }
  const script = path.join(__dirname, "..", "run.sh");
  backend = spawn(script, ["api"], { stdio: "inherit", env: { ...process.env, PORT: API_PORT } });
  let lastError;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      await checkBackend();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Backend did not start; run './run.sh api' manually. ${lastError.message}`);
}

function createWindow() {
  overlay = createOverlayWindow({
    BrowserWindow,
    protection,
    preload: path.join(__dirname, "preload.js"),
    url: APP_URL,
    onLoadError: (error) => {
      console.error("Cannot load overlay:", error);
      dialog.showErrorBox("Cannot load TechPrep", `Check ${APP_URL} and its certificate trust, then relaunch.\n${error.message}`);
      app.quit();
    },
  });
  const created = overlay.window;
  win = created;
  created.on("closed", () => {
    if (win === created) { win = null; overlay = null; }
  });
}

function openLogin() {
  const url = new URL(APP_URL);
  url.searchParams.set("login", "1");
  loginWin = new BrowserWindow({
    width: 420,
    height: 520,
    resizable: false,
    autoHideMenuBar: true,
    title: "TechPrep - Sign in",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true },
  });
  const current = loginWin;
  current.on("closed", () => { if (loginWin === current) loginWin = null; });
  current.loadURL(url.toString()).catch((error) => {
    dialog.showErrorBox("Cannot load TechPrep", `Check ${APP_URL} and its certificate trust, then relaunch.\n${error.message}`);
    app.quit();
  });
}

app.whenReady().then(async () => {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    cb(!!win && !win.isDestroyed() && wc === win.webContents &&
      details.isMainFrame && details.requestingUrl.startsWith(`${APP_ORIGIN}/`) &&
      ["media", "display-capture"].includes(permission));
  });
  // Desktop system loopback for supported platforms.
  ses.setDisplayMediaRequestHandler(async (request, cb) => {
    if (!win || win.isDestroyed() || request.frame !== win.webContents.mainFrame ||
        request.securityOrigin !== APP_ORIGIN || !request.audioRequested) {
      cb({});
      return;
    }
    try {
      const [screen] = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
      if (!screen) throw new Error("No display source is available for system-audio capture.");
      cb({
        video: screen,
        audio: ["win32", "darwin"].includes(process.platform) ? "loopback" : undefined,
      });
    } catch (error) {
      console.error("Cannot start system-audio capture:", error);
      cb({});
    }
  });

  ipcMain.handle("set-always-on-top", (_e, on) => { win.setAlwaysOnTop(!!on, "floating"); return win.isAlwaysOnTop(); });
  function requireOverlay(event) {
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) {
      throw new Error("Capture protection is only available for the overlay window.");
    }
  }
  ipcMain.handle("initialize-content-protection", (event, preference) => {
    requireOverlay(event);
    return overlay.restore(preference);
  });
  ipcMain.handle("get-content-protection", (event) => {
    requireOverlay(event);
    return protection.getState();
  });
  ipcMain.handle("set-content-protection", (event, enabled) => {
    requireOverlay(event);
    return protection.setRequested(enabled);
  });
  ipcMain.handle("login-succeeded", (event) => {
    if (!loginWin || event.sender !== loginWin.webContents || event.senderFrame !== loginWin.webContents.mainFrame) {
      throw new Error("Only the login window can open the overlay.");
    }
    const closing = loginWin;
    loginWin = null;
    createWindow(); // open the overlay before closing, so the app does not quit in between
    closing.close();
  });
  ipcMain.handle("sign-out", (event) => {
    if (!win || event.sender !== win.webContents) throw new Error("Only the overlay can sign out.");
    const closing = win;
    openLogin();
    closing.close();
  });
  ipcMain.handle("minimize", () => win.minimize());
  ipcMain.handle("close", () => win.close());
  ipcMain.handle("open-external", (_event, url) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
      return true;
    }
    return false;
  });

  try {
    await ensureBackend();
  } catch (e) {
    dialog.showErrorBox("Cannot connect to TechPrep", e.message);
    app.quit();
    return;
  }
  openLogin();
  app.on("activate", () => { if (!win && !loginWin) openLogin(); });
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => backend?.kill());
