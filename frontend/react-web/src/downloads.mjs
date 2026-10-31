import { authFetch } from "./auth.mjs";

const filenames = {
  windows: "TechPrep-Setup.exe",
  mac: "TechPrep.dmg",
  ca: "TechPrep-Local-CA.crt",
};

const CONTENT_TYPES = {
  windows: "application/octet-stream",
  mac: "application/x-apple-diskimage",
  ca: "application/x-x509-ca-cert",
};

export async function fetchDownload(api, target, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  if (!Object.hasOwn(filenames, target)) throw new Error("Unsupported download.");
  const response = await authFetch(`${api}/api/v1/downloads/${target}`, {}, fetchImpl, storage, onExpired);
  if (response.status === 401) throw new Error("Your session expired. Sign in again to download.");
  if (!response.ok) {
    let message = `Download failed (${response.status}). Please try again.`;
    if (response.headers.get("content-type")?.includes("application/json")) {
      const body = await response.json();
      if (typeof body.detail === "string") message = body.detail;
    }
    throw new Error(message);
  }
  if (!response.headers.get("content-type")?.includes(CONTENT_TYPES[target])) {
    throw new Error("The server did not return the requested download. Please contact the administrator.");
  }
  return { blob: await response.blob(), filename: filenames[target] };
}

export function saveDownload({ blob, filename }) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser time to consume the object URL before releasing the file.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
