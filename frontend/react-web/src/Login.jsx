import { useState } from "react";

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
}) {
  const [mode, setMode] = useState(resetToken ? "reset" : initialMode); // signin | signup | forgot | reset
  const [confirm, setConfirm] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const creating = mode === "signup";
  const needsConfirm = creating || mode === "reset";

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
