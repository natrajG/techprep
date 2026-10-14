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
    }
  }
  window.setAlwaysOnTop(true, "floating");
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
