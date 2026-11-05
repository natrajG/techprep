import { useEffect, useRef, useState } from "react";

export default function Login({
  onSubmit,
  onSignUp,
  onForgot,
  onReset,
  onResetDone,
  resetToken,
  initialMode = "signin",
  onBack,
  wrongPasswordHint,
  minimumPassword = 8,
  isModal = false,
  googleClientId,
  onGoogleSignIn,
  googleDesktopStartUrl,
  externalError,
  externalNotice,
}) {
  const [mode, setMode] = useState(resetToken ? "reset" : initialMode); // signin | signup | forgot | reset
  const [confirm, setConfirm] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const googleInitialized = useRef(false);
  const creating = mode === "signup";
  const needsConfirm = creating || mode === "reset";
  const showGoogleButton = (googleDesktopStartUrl || (googleClientId && onGoogleSignIn)) && (mode === "signin" || mode === "signup");

  // Surfaces the result of a desktop Google sign-in that completed in the system browser and handed
  // control back to this window (see googleDesktopStartUrl below).
  useEffect(() => {
    if (externalError) { setError(externalError); setBusy(false); }
  }, [externalError]);
  useEffect(() => {
    if (externalNotice) { setNotice(externalNotice); setBusy(false); }
  }, [externalNotice]);

  // Initializes Google Identity Services once its script has loaded, then shows our
  // own themed button (Google's auto-rendered button ignores our dark theme once a
  // browser's FedCM account chooser takes over, which looked inconsistent/out of place).
  // Not used for the desktop system-browser flow (googleDesktopStartUrl), which needs no GIS script:
  // Google blocks its interactive sign-in inside embedded browsers like an Electron window.
  useEffect(() => {
    if (googleDesktopStartUrl) { setGoogleReady(true); return; }
    if (!showGoogleButton) return;
    let cancelled = false;
    let attempts = 0;

    function tryInit() {
      if (cancelled) return;
      if (!window.google?.accounts?.id) {
        if (++attempts < 50) setTimeout(tryInit, 100);
        return;
      }
      if (!googleInitialized.current) {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async ({ credential }) => {
            setBusy(true);
            setError("");
            try {
              await onGoogleSignIn(credential);
            } catch (e) {
              setError(e.message);
              setBusy(false);
            }
          },
        });
        googleInitialized.current = true;
      }
      setGoogleReady(true);
    }
    tryInit();
    return () => { cancelled = true; };
  }, [showGoogleButton, googleClientId, googleDesktopStartUrl]);

  function handleGoogleClick() {
    if (googleDesktopStartUrl) {
      setError("");
      setNotice("Continue in your browser, then come back here \u2014 you'll be signed in automatically.");
      window.desktop?.openExternal(googleDesktopStartUrl);
      return;
    }
    if (!window.google?.accounts?.id) return;
    window.google.accounts.id.prompt();
  }

  function switchMode(next) {
    setMode(next);
    setError("");
    setNotice("");
    setPassword("");
    setConfirm("");
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (needsConfirm && password !== confirm) throw new Error("Passwords do not match.");
      if (mode === "signup") {
        await onSignUp(username, password, email);
      } else if (mode === "forgot") {
        setNotice(await onForgot(email));
        setBusy(false);
      } else if (mode === "reset") {
        setNotice(await onReset(resetToken, password));
        setMode("done");
        setBusy(false);
      } else {
        await onSubmit(username, password);
      }
    } catch (e) {
      setError(mode === "signin" && e.status === 401 && wrongPasswordHint ? `${e.message}. ${wrongPasswordHint}` : e.message);
      setBusy(false);
    }
  }

  const heading = {
    signup: "Create an account to begin.",
    forgot: "Enter your account email and we will send a reset link.",
    reset: "Choose a new password.",
    done: "",
  }[mode] ?? "Sign in to open the assistant.";

  return (
    <div style={isModal ? styles.modalOverlay : styles.page} onClick={isModal ? onBack : undefined}>
      <form onSubmit={submit} style={styles.card} onClick={(e) => e.stopPropagation()}>
        {isModal && (
          <button type="button" style={styles.closeBtn} onClick={onBack} aria-label="Close">
            ✕
          </button>
        )}
        <div style={styles.brandRow}>
          <span style={styles.logoDot}></span>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>TechPrep</h2>
        </div>
        <p style={{ margin: "4px 0 16px", color: "#94a3b8", fontSize: 13.5 }}>{heading}</p>

        {mode === "done" ? (
          <>
            <p role="status" style={{ color: "#86efac", margin: "0 0 14px", fontSize: 14 }}>{notice}</p>
            <button type="button" style={styles.button} onClick={() => { onResetDone?.(); switchMode("signin"); }}>
              Go to sign in
            </button>
          </>
        ) : (
          <>
            {showGoogleButton && (
              <>
                <button
                  type="button"
                  style={styles.googleButton}
                  onClick={handleGoogleClick}
                  disabled={!googleReady || busy}
                >
                  <span style={styles.googleIconWrap} aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 48 48">
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.9-2.26 5.35-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                    </svg>
                  </span>
                  {creating ? "Sign up with Google" : "Sign in with Google"}
                </button>
                <div style={styles.dividerRow}>
                  <span style={styles.dividerLine}></span>
                  <span style={{ color: "#64748b", fontSize: 12 }}>or</span>
                  <span style={styles.dividerLine}></span>
                </div>
              </>
            )}
            {(mode === "signin" || mode === "signup") && (
              <label style={styles.label}>Username
                <input style={styles.input} value={username} autoComplete="username" autoFocus required
                  onChange={(e) => setUsername(e.target.value)} />
              </label>
            )}
            {(creating || mode === "forgot") && (
              <label style={styles.label}>Email
                <input style={styles.input} type="email" value={email} autoComplete="email" required maxLength={254}
                  autoFocus={mode === "forgot"} onChange={(e) => setEmail(e.target.value)} />
              </label>
            )}
            {mode !== "forgot" && (
              <label style={styles.label}>{mode === "reset" ? "New password" : "Password"}
                <input style={styles.input} type="password" value={password} autoFocus={mode === "reset"}
                  autoComplete={needsConfirm ? "new-password" : "current-password"} required
                  minLength={needsConfirm ? minimumPassword : undefined}
                  onChange={(e) => setPassword(e.target.value)} />
              </label>
            )}
            {needsConfirm && (
              <label style={styles.label}>Confirm password
                <input style={styles.input} type="password" value={confirm} autoComplete="new-password" required
                  onChange={(e) => setConfirm(e.target.value)} />
              </label>
            )}
            {error && <p role="alert" style={{ color: "#f87171", margin: "0 0 10px", fontSize: 13 }}>{error}</p>}
            {notice && <p role="status" style={{ color: "#86efac", margin: "0 0 10px", fontSize: 13 }}>{notice}</p>}
            <button type="submit" style={styles.button} disabled={busy}>
              {busy ? "Please wait…" : {
                signup: "Create account", forgot: "Send reset link", reset: "Set new password",
              }[mode] ?? "Sign in"}
            </button>
            {mode === "signin" && onForgot && (
              <button type="button" style={styles.link} disabled={busy} onClick={() => switchMode("forgot")}>
                Forgot password?
              </button>
            )}
            {mode === "forgot" && (
              <button type="button" style={styles.link} disabled={busy} onClick={() => switchMode("signin")}>
                ← Back to sign in
              </button>
            )}
            {onSignUp && (mode === "signin" || mode === "signup") && (
              <button type="button" style={styles.link} disabled={busy}
                onClick={() => switchMode(creating ? "signin" : "signup")}>
                {creating ? "Already have an account? Sign in" : "No account? Sign up"}
              </button>
            )}
          </>
        )}
        {onBack && (
          <button type="button" style={{ ...styles.link, color: "#94a3b8" }} onClick={onBack}>
            ← Back to Home
          </button>
        )}
        <a href="/privacy/" target="_blank" rel="noopener noreferrer" style={styles.privacy}>Privacy policy</a>
      </form>
    </div>
  );
}

const styles = {
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(3, 7, 18, 0.75)",
    backdropFilter: "blur(8px)",
    display: "grid",
    placeItems: "center",
    zIndex: 1000,
    padding: 16,
    boxSizing: "border-box",
  },
  page: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    background: "#080a11",
    color: "#f8fafc",
    padding: 16,
    boxSizing: "border-box",
  },
  card: {
    position: "relative",
    width: 360,
    maxWidth: "92vw",
    background: "linear-gradient(145deg, #10131e 0%, #0d0f17 100%)",
    padding: 28,
    borderRadius: 16,
    border: "1px solid rgba(255, 255, 255, 0.1)",
    boxShadow: "0 25px 60px rgba(0, 0, 0, 0.7), 0 0 30px rgba(99, 102, 241, 0.15)",
    boxSizing: "border-box",
  },
  closeBtn: {
    position: "absolute",
    top: 14,
    right: 14,
    background: "rgba(255, 255, 255, 0.08)",
    border: "none",
    color: "#94a3b8",
    fontSize: 16,
    width: 28,
    height: 28,
    borderRadius: "50%",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
  },
  brandRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4 },
  logoDot: { width: 8, height: 8, borderRadius: "50%", background: "#4f46e5", boxShadow: "0 0 10px #6366f1" },
  googleButton: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid rgba(255, 255, 255, 0.16)",
    background: "#1a1b1f",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    marginBottom: 14,
    boxShadow: "0 2px 10px rgba(0, 0, 0, 0.25)",
  },
  googleIconWrap: {
    width: 20,
    height: 20,
    borderRadius: 4,
    background: "#fff",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  },
  dividerRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 14 },
  dividerLine: { flex: 1, height: 1, background: "rgba(255, 255, 255, 0.12)" },
  label: { display: "block", fontSize: 13, marginBottom: 14, color: "#cbd5e1" },
  input: {
    display: "block",
    width: "100%",
    marginTop: 6,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid rgba(255, 255, 255, 0.15)",
    background: "rgba(255, 255, 255, 0.05)",
    color: "#ffffff",
    boxSizing: "border-box",
    fontSize: 14,
  },
  button: {
    width: "100%",
    padding: "11px",
    border: 0,
    borderRadius: 8,
    background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 4px 15px rgba(99, 102, 241, 0.35)",
  },
  link: {
    width: "100%",
    marginTop: 12,
    padding: 6,
    border: 0,
    background: "none",
    color: "#818cf8",
    fontSize: 13,
    cursor: "pointer",
  },
  privacy: { display: "block", marginTop: 16, color: "#64748b", fontSize: 12, textAlign: "center", textDecoration: "none" },
};
