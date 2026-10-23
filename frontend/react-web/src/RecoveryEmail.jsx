import { useEffect, useState } from "react";
import { fetchRecoveryEmail, saveRecoveryEmail } from "./auth.mjs";

const API = import.meta.env.VITE_API_URL || "";

// Lets existing accounts add the email address used by "Forgot password?".
export default function RecoveryEmail() {
  const [saved, setSaved] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState({ text: "", error: false });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchRecoveryEmail(API).then(
      (value) => active && (setSaved(value), setEmail(value)),
      () => active && setSaved(""),
    );
    return () => { active = false; };
  }, []);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setMessage({ text: "", error: false });
    try {
      const value = await saveRecoveryEmail(API, email, password);
      setSaved(value);
      setEmail(value);
      setPassword("");
      setMessage({ text: "Recovery email saved.", error: false });
    } catch (error) {
      setMessage({ text: error.message, error: true });
    }
    setBusy(false);
  }

  if (saved === null) return null;
  return (
    <form onSubmit={save} style={styles.form}>
      <p style={styles.hint}>
        {saved ? "Used to send you a link if you forget your password." : "Add an email so you can reset your password if you forget it."}
      </p>
      <label style={styles.label}>Email
        <input style={styles.input} type="email" value={email} required maxLength={254} autoComplete="email"
          onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label style={styles.label}>Current password (to confirm it is you)
        <input style={styles.input} type="password" value={password} required autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)} />
      </label>
      {message.text && (
        <p role={message.error ? "alert" : "status"} style={{ margin: "0 0 10px", fontSize: 13, color: message.error ? "#f87171" : "#86efac" }}>
          {message.text}
        </p>
      )}
      <button type="submit" disabled={busy || (email === saved && !password)} style={styles.button}>
        {busy ? "Saving…" : saved ? "Update email" : "Save email"}
      </button>
    </form>
  );
}

const styles = {
  form: { maxWidth: 380 },
  hint: { color: "#94a3b8", fontSize: 13, lineHeight: 1.6, margin: "0 0 14px" },
  label: { display: "block", fontSize: 13, marginBottom: 12, color: "#cbd5e1" },
  input: {
    display: "block", width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 8,
    border: "1px solid rgba(255, 255, 255, 0.15)", background: "rgba(255, 255, 255, 0.05)",
    color: "#ffffff", boxSizing: "border-box", fontSize: 14,
  },
  button: {
    padding: "10px 18px", border: 0, borderRadius: 8, background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
    color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
  },
};
