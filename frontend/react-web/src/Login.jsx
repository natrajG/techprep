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
        <h2 style={{ margin: "0 0 4px" }}>TechPrep</h2>
        <p style={{ margin: "0 0 12px", color: "#64748b", fontSize: 14 }}>{creating ? "Create an account." : "Sign in to open the assistant."}</p>
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
        {error && <p role="alert" style={{ color: "#b91c1c", margin: "0 0 10px", fontSize: 14 }}>{error}</p>}
        <button type="submit" style={styles.button} disabled={busy}>{busy ? "Please wait…" : creating ? "Create account" : "Sign in"}</button>
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
  page: { fontFamily: "system-ui, sans-serif", minHeight: "100vh", display: "grid", placeItems: "center", background: "#f1f5f9", color: "#0f172a" },
  card: { width: 320, maxWidth: "90vw", background: "#fff", padding: 24, borderRadius: 12, boxShadow: "0 4px 24px #0f172a1a", boxSizing: "border-box" },
  label: { display: "block", fontSize: 13, marginBottom: 12 },
  input: { display: "block", width: "100%", marginTop: 4, padding: 9, borderRadius: 8, border: "1px solid #cbd5e1", boxSizing: "border-box", fontSize: 15 },
  button: { width: "100%", padding: 10, border: 0, borderRadius: 8, background: "#2563eb", color: "#fff", fontSize: 15, cursor: "pointer" },
  link: { width: "100%", marginTop: 10, padding: 6, border: 0, background: "none", color: "#2563eb", fontSize: 14, cursor: "pointer" },
  privacy: { display: "block", marginTop: 14, color: "#2563eb", fontSize: 13, textAlign: "center" },
};
