function detectCapability({ platform, release, electronVersion, apiAvailable }) {
  const unsupported = (detail) => ({ supported: false, mechanism: "none", detail });
  if (platform === "linux") {
    return unsupported("Electron's native capture-protection API is unsupported on Linux. Share a specific application window or browser tab instead of the entire screen.");
  }
  if (!["win32", "darwin"].includes(platform)) {
    return unsupported("Electron's native capture-protection API is unsupported on this platform.");
  }
  if (!apiAvailable || !/^\d+\./.test(electronVersion) || Number(electronVersion.split(".")[0]) < 44) {
    return unsupported("This application requires Electron 44 or later with BrowserWindow.setContentProtection.");
  }
  const version = /^\d+\.\d+\.\d+$/.test(release) ? release.split(".").map(Number) : [];
  if (platform === "win32") {
    if (version.length !== 3 || version[0] < 10) {
      return unsupported("Windows 10 or later is required; the operating system version could not be confirmed as supported.");
    }
    const exclusion = version[0] > 10 || version[2] >= 19041;
    return {
      supported: true,
      mechanism: exclusion ? "WDA_EXCLUDEFROMCAPTURE" : "WDA_MONITOR",
      detail: `${exclusion
        ? "Windows 10 version 2004+ can exclude this window from compatible capture paths."
        : "Before Windows 10 version 2004, compatible captures show a blank/black window instead of excluding it."} Electron does not report the native display-affinity result. Some capture paths can bypass it; check the actual recording and sharing preview.`,
    };
  }
  if (version.length !== 3 || version[0] < 22) {
    return unsupported("Electron 44 requires macOS 13 or later (Darwin 22+); this OS version is not confirmed as supported.");
  }
  return {
    supported: true,
    mechanism: "NSWindowSharingNone",
    detail: "macOS window-sharing restriction only. ScreenCaptureKit-based capture can still include this window. This is not a recording block; check the actual recording and sharing preview.",
  };
}

function createCaptureProtection(environment, logger = console) {
  let window = null;
  let requested = false;
  let state;

  function apply() {
    const capability = detectCapability({
      ...environment,
      apiAvailable: typeof window?.setContentProtection === "function",
    });
    state = { ...capability, requested, enabled: false, status: "unsupported", error: null };
    if (!capability.supported) return getState();
    if (!window || window.isDestroyed()) {
      state.status = "failed";
      state.error = "The overlay window is no longer available.";
      logger.error("Capture protection request failed:", state.error);
      return getState();
    }
    try {
      // Electron returns void, not the Windows native success result.
      window.setContentProtection(requested);
      state.enabled = requested;
      state.status = requested ? "enabled" : "disabled";
    } catch (error) {
      state.status = "failed";
      state.error = error.message;
      logger.error("Capture protection request failed:", error);
    }
    return getState();
  }

  function getState() {
    return { ...state };
  }

  return {
    attach(overlay) {
      window = overlay;
      return apply();
    },
    setRequested(value) {
      if (typeof value !== "boolean") throw new TypeError("Expected a boolean capture-protection preference.");
      requested = value;
      return apply();
    },
    getState,
  };
}

module.exports = { detectCapability, createCaptureProtection };
