import { useState } from "react";

export default function Login({ onSubmit, onSignUp, minimumPassword = 8 }) {
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (creating) {
        if (password !== confirm) throw new Error("Passwords do not match.");
        await onSignUp(username, password);
      } else {
        await onSubmit(username, password);
      }
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <main style={styles.page}>
      <form onSubmit={submit} style={styles.card}>
        <div style={styles.brandRow}>
          <span style={styles.logoDot}></span>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>TechPrep</h2>
        </div>
        <p style={{ margin: "4px 0 16px", color: "#94a3b8", fontSize: 13.5 }}>
          {creating ? "Create an account to begin." : "Sign in to open the assistant."}
        </p>

        <label style={styles.label}>Username
          <input style={styles.input} value={username} autoComplete="username" autoFocus required
            onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label style={styles.label}>Password
          <input style={styles.input} type="password" value={password} autoComplete={creating ? "new-password" : "current-password"} required minLength={creating ? minimumPassword : undefined}
            onChange={(e) => setPassword(e.target.value)} />
        </label>
        {creating && (
          <label style={styles.label}>Confirm password
            <input style={styles.input} type="password" value={confirm} autoComplete="new-password" required
              onChange={(e) => setConfirm(e.target.value)} />
          </label>
        )}
        {error && <p role="alert" style={{ color: "#f87171", margin: "0 0 10px", fontSize: 13 }}>{error}</p>}
        <button type="submit" style={styles.button} disabled={busy}>
          {busy ? "Please wait…" : creating ? "Create account" : "Sign in"}
        </button>
        {onSignUp && (
          <button type="button" style={styles.link} disabled={busy}
            onClick={() => { setCreating(!creating); setError(""); }}>
            {creating ? "Already have an account? Sign in" : "No account? Sign up"}
          </button>
        )}
        <a href="/privacy/" target="_blank" rel="noopener noreferrer" style={styles.privacy}>Privacy policy</a>
      </form>
    </main>
  );
}

const styles = {
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
    width: 360,
    maxWidth: "92vw",
    background: "linear-gradient(145deg, #10131e 0%, #0d0f17 100%)",
    padding: 28,
    borderRadius: 16,
    border: "1px solid rgba(255, 255, 255, 0.1)",
    boxShadow: "0 25px 60px rgba(0, 0, 0, 0.7), 0 0 30px rgba(99, 102, 241, 0.15)",
    boxSizing: "border-box",
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
