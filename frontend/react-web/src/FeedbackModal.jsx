import { useState } from "react";
import { submitFeedback } from "./feedback.mjs";
import Dialog from "./Dialog";
import Icon from "./Icon";

const API = import.meta.env.VITE_API_URL || "";
const notifyExpired = () => window.dispatchEvent(new Event("auth-expired"));
const CATEGORIES = [
  { id: "bug", label: "Bug report" },
  { id: "suggestion", label: "Suggestion" },
  { id: "other", label: "Other" },
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
    <Dialog label="Send feedback" onClose={onClose} style={{ maxWidth: 500 }}>
        <div className="tp-dialog-heading">
          <div><span className="tp-eyebrow">LET’S MAKE THIS BETTER</span><h2>We’re listening.</h2></div>
          <button className="tp-btn" onClick={onClose} aria-label="Close feedback"><Icon name="close" size={18} /></button>
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
            <button type="submit" className="tp-btn tp-btn-primary" disabled={sending}>
              {sending ? "Sending…" : "Send Feedback"}
            </button>
          </form>
        )}
    </Dialog>
  );
}

const styles = {
  body: { display: "flex", flexDirection: "column", gap: 14, padding: 18 },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#d3cedf" },
  input: {
    padding: "8px 10px", borderRadius: 8, border: "1px solid #334155", background: "#151b2b",
    color: "#fff", fontSize: 13, fontFamily: "inherit",
  },
  primaryBtn: {
    background: "#7058db", color: "#ffffff", border: "none",
    padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer",
  },
};
