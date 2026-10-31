import { useState } from "react";
import { fetchDownload, saveDownload } from "./downloads.mjs";

const API = import.meta.env.VITE_API_URL || "";
const notifyExpired = () => window.dispatchEvent(new Event("auth-expired"));

export default function DesktopDownload({ localNetwork = true, storeUrl = null }) {
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [copiedFix, setCopiedFix] = useState(false);

  const copyFixCmd = () => {
    navigator.clipboard?.writeText("xattr -cr /Applications/TechPrep.app");
    setCopiedFix(true);
    setTimeout(() => setCopiedFix(false), 3000);
  };

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
    <section className="hud-card dd-card" aria-label="Download desktop app">
      <div className="dd-platform">
        <div className="hud-row dd-platform-row">
          <span className="dd-icon" aria-hidden="true">🪟</span>
          <strong>TechPrep for Windows</strong>
          {localNetwork ? (
            <button className="dd-btn" onClick={() => download("windows")} disabled={!!pending}>
              {pending === "windows" ? "Downloading Windows app..." : "Download Windows app"}
            </button>
          ) : storeUrl ? (
            <a className="dd-btn dd-btn--store" href={storeUrl} target="_blank" rel="noopener noreferrer">
              🛒 Install from Microsoft Store
            </a>
          ) : <span className="hud-muted">Microsoft Store release coming soon.</span>}
        </div>
        <p className="hud-muted">
          Windows 10/11 (64-bit). Install for a transparent, always-on-top window and best-effort capture protection.
          Sign in again in the app.{localNetwork ? " Keep this server running and stay on the same network." : " An internet connection is required."}
        </p>
      </div>

      <div className="dd-divider" role="separator" />

      <div className="dd-platform">
        <div className="hud-row dd-platform-row">
          <span className="dd-icon" aria-hidden="true"></span>
          <strong>TechPrep for Mac</strong>
          <span className="dd-badge dd-badge--free" title="Free build: not yet code-signed or Apple-notarized">
            Free build
          </span>
          <button className="dd-btn" onClick={() => download("mac")} disabled={!!pending}>
            {pending === "mac" ? "Downloading Mac app..." : "Download Mac app"}
          </button>
        </div>
        <p className="hud-muted">
          macOS 13 (Ventura) or later. Install for a transparent, always-on-top window and
          best-effort capture protection. Sign in again in the app.
          {localNetwork ? " Keep this server running and stay on the same network." : " An internet connection is required."}
        </p>
        <details className="dd-details" open>
          <summary>🛡️ Opening on macOS ("TechPrep is damaged" Gatekeeper warning)</summary>
          <div className="hud-muted" style={{ marginTop: "0.5rem", lineHeight: "1.5" }}>
            <p style={{ margin: "0 0 0.5rem" }}>
              <strong>TechPrep is safe, clean, and not malware.</strong> Because this is a free community release not yet enrolled in Apple&apos;s $99/year developer program, macOS Gatekeeper blocks it with:
              <br />
              <code style={{ display: "inline-block", background: "rgba(239,68,68,0.15)", color: "#fca5a5", padding: "3px 8px", borderRadius: "4px", margin: "6px 0", fontSize: "0.85rem" }}>
                &ldquo;TechPrep&rdquo; is damaged and can&apos;t be opened. You should move it to the Trash.
              </code>
              <br />
              <strong>Do not move to Trash.</strong> The file is completely intact. Apple shows this message for all unsigned internet downloads.
            </p>
            <div style={{ background: "rgba(255,255,255,0.05)", padding: "10px 12px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.1)", marginTop: "8px" }}>
              <div style={{ fontWeight: 600, marginBottom: "6px", color: "#e2e8f0" }}>⚡ 5-Second Fix (Run once in Terminal):</div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                <code style={{ background: "#0f172a", padding: "6px 10px", borderRadius: "4px", color: "#38bdf8", fontSize: "0.85rem", flex: 1, minWidth: "220px" }}>
                  xattr -cr /Applications/TechPrep.app
                </code>
                <button
                  type="button"
                  className="dd-btn"
                  style={{ padding: "4px 12px", fontSize: "0.85rem" }}
                  onClick={copyFixCmd}
                >
                  {copiedFix ? "✓ Copied!" : "📋 Copy Command"}
                </button>
              </div>
              <p style={{ margin: "8px 0 0", fontSize: "0.8rem", color: "#94a3b8" }}>
                1. Drag <strong>TechPrep</strong> to <strong>Applications</strong>.<br />
                2. Press <kbd>Cmd</kbd> + <kbd>Space</kbd>, type <strong>Terminal</strong>, and press Enter.<br />
                3. Paste the command above and press Enter. TechPrep will launch immediately!
              </p>
              <div style={{ marginTop: "8px", fontSize: "0.8rem" }}>
                Prefer a double-click fix?{" "}
                <a href="/Fix-TechPrep.command" download="Fix-TechPrep.command" style={{ color: "#38bdf8", textDecoration: "underline" }}>
                  Download Fix-TechPrep.command
                </a>
              </div>
            </div>
          </div>
        </details>
      </div>

      {localNetwork && (
        <details className="dd-details">
          <summary>First-time LAN HTTPS setup</summary>
          <p className="hud-muted">
            If you have not already trusted this server's local CA, download its certificate and import it into
            Windows Trusted Root Certification Authorities (Current User). Only trust a CA from a server you know.
            This is not needed for a publicly trusted HTTPS certificate.
          </p>
          <button className="dd-btn" onClick={() => download("ca")} disabled={!!pending}>
            {pending === "ca" ? "Downloading certificate..." : "Download local CA certificate"}
          </button>
        </details>
      )}
      {message && <p className="hud-muted" role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
