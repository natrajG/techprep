import { useState } from "react";
import { submitRating } from "./ratings.mjs";

const API = import.meta.env.VITE_API_URL || "";
const notifyExpired = () => window.dispatchEvent(new Event("auth-expired"));

const TITLES = {
  trial: "How was your free trial interview?",
  paid: "How was your interview session?",
};

export default function RatingPopup({ context, onClose, onSubmitted }) {
  const [stars, setStars] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!stars) {
      setError("Please pick a star rating.");
      return;
    }
    setError("");
    setSending(true);
    try {
      await submitRating(API, stars, context, comment.trim(), fetch, localStorage, notifyExpired);
      setSent(true);
      onSubmitted?.(stars);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(event) => event.stopPropagation()}>
        <button style={styles.closeBtn} onClick={onClose} title="Close">✕</button>
        {sent ? (
          <div style={styles.body}>
            <p style={{ fontSize: 28, margin: "0 0 10px" }}>🙌</p>
            <p style={{ color: "#86efac", margin: "0 0 16px" }}>Thanks for rating TechPrep!</p>
            <button style={styles.primaryBtn} onClick={onClose}>Close</button>
          </div>
        ) : (
          <form style={styles.body} onSubmit={submit}>
            <h3 style={styles.title}>{TITLES[context] || "How was your experience?"}</h3>
            <div style={styles.stars} role="radiogroup" aria-label="Star rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={stars === n}
                  aria-label={`${n} star${n > 1 ? "s" : ""}`}
                  style={styles.starBtn}
                  onMouseEnter={() => setHovered(n)}
                  onMouseLeave={() => setHovered(0)}
                  onClick={() => setStars(n)}
                >
                  <span style={{ color: (hovered || stars) >= n ? "#facc15" : "#475569" }}>★</span>
                </button>
              ))}
            </div>
            <textarea
              style={styles.input}
              placeholder="Anything you'd like to tell us? (optional)"
              maxLength={1000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            {error && <p role="alert" style={{ color: "#fca5a5", margin: 0, fontSize: 12 }}>{error}</p>}
            <div style={styles.actions}>
              <button type="button" style={styles.secondaryBtn} onClick={onClose}>Not now</button>
              <button type="submit" style={styles.primaryBtn} disabled={sending}>
                {sending ? "Sending…" : "Submit Rating"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0, 0, 0, 0.6)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100,
  },
  modal: {
    width: 380, maxWidth: "90vw", background: "#10131d", border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: 14, color: "#f8fafc", boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5)", position: "relative",
    textAlign: "center",
  },
  closeBtn: {
    position: "absolute", top: 10, right: 12, background: "transparent", border: "none",
    color: "#94a3b8", fontSize: 16, cursor: "pointer",
  },
  body: { display: "flex", flexDirection: "column", gap: 14, padding: "26px 22px 20px" },
  title: { margin: "0 0 4px", fontSize: 16, fontWeight: 700 },
  stars: { display: "flex", justifyContent: "center", gap: 4 },
  starBtn: {
    background: "transparent", border: "none", fontSize: 30, lineHeight: 1, cursor: "pointer", padding: 2,
  },
  input: {
    padding: "8px 10px", borderRadius: 8, border: "1px solid #334155", background: "#151b2b",
    color: "#fff", fontSize: 13, fontFamily: "inherit", height: 70, resize: "vertical",
  },
  actions: { display: "flex", justifyContent: "center", gap: 10, marginTop: 4 },
  secondaryBtn: {
    background: "transparent", border: "1px solid #334155", color: "#cbd5e1", padding: "9px 16px",
    borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
  },
  primaryBtn: {
    background: "linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)", color: "#080a11", border: "none",
    padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer",
  },
};
