import { useState } from "react";
import { submitFeedback } from "./feedback.mjs";

const API = import.meta.env.VITE_API_URL || "";
const notifyExpired = () => window.dispatchEvent(new Event("auth-expired"));
const CATEGORIES = [
  { id: "bug", label: "🐞 Bug report" },
  { id: "suggestion", label: "💡 Suggestion" },
  { id: "other", label: "💬 Other" },
];

export default function FeedbackModal({ onClose }) {
  const [category, setCategory] = useState("bug");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!message.trim()) {
      setError("Please describe your feedback before sending.");
      return;
    }
    setError("");
    setSending(true);
    try {
      await submitFeedback(API, category, message.trim(), fetch, localStorage, notifyExpired);
      setSent(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(event) => event.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={styles.title}>Send Feedback</h3>
          <button style={styles.closeBtn} onClick={onClose} title="Close">✕</button>
        </div>
        {sent ? (
          <div style={styles.body}>
            <p style={{ color: "#86efac", margin: "0 0 16px" }}>
              Thanks! Your feedback has been sent to our team.
            </p>
            <button style={styles.primaryBtn} onClick={onClose}>Close</button>
          </div>
        ) : (
          <form style={styles.body} onSubmit={submit}>
            <label style={styles.label}>Category
              <select style={styles.input} value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label style={styles.label}>Message
              <textarea
                style={{ ...styles.input, height: 110, resize: "vertical" }}
                placeholder="Tell us what happened or what you'd like to see…"
                maxLength={2000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </label>
            {error && <p role="alert" style={{ color: "#fca5a5", margin: 0 }}>{error}</p>}
            <button type="submit" style={styles.primaryBtn} disabled={sending}>
              {sending ? "Sending…" : "Send Feedback"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0, 0, 0, 0.6)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
  },
  modal: {
    width: 420, maxWidth: "90vw", background: "#10131d", border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: 14, color: "#f8fafc", boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5)",
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "16px 18px", borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
  },
  title: { margin: 0, fontSize: 16, fontWeight: 700 },
  closeBtn: {
    background: "transparent", border: "none", color: "#94a3b8", fontSize: 16, cursor: "pointer",
  },
  body: { display: "flex", flexDirection: "column", gap: 14, padding: 18 },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#cbd5e1" },
  input: {
    padding: "8px 10px", borderRadius: 8, border: "1px solid #334155", background: "#151b2b",
    color: "#fff", fontSize: 13, fontFamily: "inherit",
  },
  primaryBtn: {
    background: "linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)", color: "#080a11", border: "none",
    padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer",
  },
};
