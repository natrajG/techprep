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
        : target === "mac"
        ? "Download started. Open TechPrep.dmg, drag TechPrep to Applications, then sign in in the app. "
          + "TechPrep is safe and is not malware; if macOS warns that the developer cannot be verified, "
          + "see \"Opening TechPrep on Mac\" below."
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
      <div className="hud-row">
        <strong>TechPrep for Mac</strong>
        <button onClick={() => download("mac")} disabled={!!pending}>
          {pending === "mac" ? "Downloading Mac app..." : "Download Mac app"}
        </button>
      </div>
      <p className="hud-muted">
        macOS 13 (Ventura) or later. Install for a transparent, always-on-top window and
        best-effort capture protection. Sign in again in the app.
        {localNetwork ? " Keep this server running and stay on the same network." : " An internet connection is required."}
      </p>
      <details>
        <summary>Opening TechPrep on Mac for the first time</summary>
        <p className="hud-muted">
          <strong>TechPrep is safe and is not malware.</strong> This release is simply not yet Apple-notarized
          (that requires a paid Apple Developer account, which we have not purchased yet), so macOS Gatekeeper
          shows a generic warning that "TechPrep cannot be opened because the developer cannot be verified." This
          is only because Apple has not reviewed/stamped the app, not because anything is wrong with it, and it
          does not block installation. In Finder, right-click (or Control-click) TechPrep and choose
          <strong> Open</strong>, then confirm <strong>Open</strong> in the dialog. You only need to do this once.
          Alternatively, go to System Settings → Privacy &amp; Security and click <strong>Open Anyway</strong>
          after the first blocked attempt. Once we buy an Apple Developer account, future downloads will be fully
          signed and notarized and this warning will no longer appear.
        </p>
      </details>
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
