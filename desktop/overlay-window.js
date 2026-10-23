function createOverlayWindow({ BrowserWindow, protection, preload, url, onLoadError }) {
  const window = new BrowserWindow({
    width: 680,
    height: 720,
    minWidth: 320,
    minHeight: 300,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true, // stealth: never show an icon/entry in the Windows taskbar or Alt+Tab switcher
    backgroundColor: "#00000000",
    title: "TechPrep",
    webPreferences: { preload, contextIsolation: true },
  });
  let ready = false;
  let restored = false;
  let shown = false;
  let restoreTimer;
  function showWhenRestored() {
    if (ready && restored && !shown && !window.isDestroyed()) {
      shown = true;
      window.show();
      window.setSkipTaskbar(true);
    }
  }
  window.setAlwaysOnTop(true, "floating");
  window.setSkipTaskbar(true); // Windows requires this call in addition to the constructor option to fully hide it
  protection.attach(window);
  window.once("ready-to-show", () => {
    ready = true;
    showWhenRestored();
  });
  window.webContents.once("did-finish-load", () => {
    if (!restored) {
      restoreTimer = setTimeout(() => {
        onLoadError(new Error("The renderer did not restore the capture preference; the overlay has not been shown."));
      }, 15000);
    }
  });
  window.once("closed", () => clearTimeout(restoreTimer));
  window.loadURL(url).catch(onLoadError);
  return {
    window,
    restore(preference) {
      const state = protection.setRequested(preference);
      // localStorage belongs to the renderer origin. Do not show its contents
      // until the saved preference has crossed IPC and been applied.
      restored = true;
      clearTimeout(restoreTimer);
      showWhenRestored();
      return state;
    },
  };
}

module.exports = { createOverlayWindow };
