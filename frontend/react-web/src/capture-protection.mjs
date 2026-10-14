const PREFERENCE_KEY = "captureProtection";
const defaultCapturePreference = (desktop) => ["win32", "darwin"].includes(desktop?.platform);

export async function restoreCaptureProtection(desktop, storage) {
  let requested = defaultCapturePreference(desktop);
  let error = "";
  try {
    const saved = storage.getItem(PREFERENCE_KEY);
    if (saved !== null && saved !== "true" && saved !== "false") {
      throw new Error("The saved preference is not a boolean.");
    }
    if (saved !== null) {
      requested = saved === "true";
    }
  } catch (cause) {
    error = `Cannot restore capture preference; requesting ${requested ? "on" : "off"} for this window. ${cause.message}`;
  }
  const state = await desktop.initializeContentProtection(requested);
  return { state, error };
}

export async function changeCaptureProtection(desktop, storage, requested) {
  if (typeof requested !== "boolean") throw new TypeError("Expected a boolean capture-protection preference.");
  // Persist intent, including failed native requests, for retry on the next launch.
  storage.setItem(PREFERENCE_KEY, String(requested));
  try {
    return await desktop.setContentProtection(requested);
  } catch (cause) {
    const error = new Error(`Preference saved, but the protection request could not be confirmed: ${cause.message}`, { cause });
    error.requested = requested;
    throw error;
  }
}

export function captureStatusMessage(state) {
  switch (state.status) {
    case "enabled":
      return `Protection requested (best effort). Electron accepted the API call; this does not prove recordings are blocked. ${state.detail}`;
    case "disabled":
      return `Disabled by you. No capture protection is requested. ${state.detail}`;
    case "unsupported":
      return `Unsupported on this platform. No protection was applied. ${state.detail}`;
    case "failed":
      return `Protection request failed: ${state.error} Actual capture behavior is unknown. Your preference remains ${state.requested ? "on" : "off"}; retry the request.`;
    default:
      return "Reading capture-protection status...";
  }
}
