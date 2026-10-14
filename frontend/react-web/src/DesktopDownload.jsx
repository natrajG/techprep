import { useState } from "react";
import { fetchDownload, saveDownload } from "./downloads.mjs";

const API = import.meta.env.VITE_API_URL || "";
const notifyExpired = () => window.dispatchEvent(new Event("auth-expired"));

export default function DesktopDownload({ localNetwork = true, storeUrl = null }) {
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function download(target) {
    setPending(target);
    setError("");
    setMessage("");
    try {
      saveDownload(await fetchDownload(API, target, fetch, localStorage, notifyExpired));
      setMessage(target === "windows"
        ? "Download started. Open TechPrep-Setup.exe, install TechPrep, then sign in in the app."
        : "Certificate downloaded. Import it into Trusted Root Certification Authorities for the current Windows user, then restart TechPrep.");
    } catch (e) {
      setError(e.message);
    } finally {
      setPending("");
    }
  }

  return (
    <section className="hud-card" aria-label="Download desktop app">
      <div className="hud-row">
        <strong>TechPrep for Windows</strong>
        {localNetwork ? (
          <button onClick={() => download("windows")} disabled={!!pending}>
            {pending === "windows" ? "Downloading Windows app..." : "Download Windows app"}
          </button>
        ) : storeUrl ? (
          <a className="hud-pill" href={storeUrl} target="_blank" rel="noopener noreferrer">
            Install from Microsoft Store
          </a>
        ) : <span className="hud-muted">Microsoft Store release coming soon.</span>}
      </div>
      <p className="hud-muted">
        Windows 10/11 (64-bit). Install for a transparent, always-on-top window and best-effort capture protection.
        Sign in again in the app.{localNetwork ? " Keep this server running and stay on the same network." : " An internet connection is required."}
      </p>
      {localNetwork && (
        <details>
          <summary>First-time LAN HTTPS setup</summary>
          <p className="hud-muted">
            If you have not already trusted this server's local CA, download its certificate and import it into
            Windows Trusted Root Certification Authorities (Current User). Only trust a CA from a server you know.
            This is not needed for a publicly trusted HTTPS certificate.
          </p>
          <button onClick={() => download("ca")} disabled={!!pending}>
            {pending === "ca" ? "Downloading certificate..." : "Download local CA certificate"}
          </button>
        </details>
      )}
      {message && <p className="hud-muted" role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
