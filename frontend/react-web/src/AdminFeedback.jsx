import { useEffect, useState } from "react";
import { fetchFeedback, updateFeedbackStatus, deleteFeedback, clearResolvedFeedback } from "./feedback.mjs";

const API = import.meta.env.VITE_API_URL || "";
const notifyExpired = () => window.dispatchEvent(new Event("auth-expired"));

export default function AdminFeedback() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [clearing, setClearing] = useState(false);

  function load() {
    fetchFeedback(API, fetch, localStorage, notifyExpired)
      .then(({ items: loaded }) => setItems(loaded))
      .catch((e) => setError(`Cannot load feedback: ${e.message}`));
  }

  useEffect(load, []);

  async function resolve(id) {
    setError("");
    setBusyId(id);
    try {
      await updateFeedbackStatus(API, id, "resolved", fetch, localStorage, notifyExpired);
      setItems((current) => current.map((item) => item.id === id ? { ...item, status: "resolved" } : item));
    } catch (e) {
      setError(`Cannot resolve feedback: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id) {
    setError("");
    setBusyId(id);
    try {
      await deleteFeedback(API, id, fetch, localStorage, notifyExpired);
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (e) {
      setError(`Cannot delete feedback: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function clearResolved() {
    setError("");
    setClearing(true);
    try {
      await clearResolvedFeedback(API, fetch, localStorage, notifyExpired);
      setItems((current) => current.filter((item) => item.status !== "resolved"));
    } catch (e) {
      setError(`Cannot clear resolved feedback: ${e.message}`);
    } finally {
      setClearing(false);
    }
  }

  const hasResolved = items.some((item) => item.status === "resolved");

  return (
    <section style={styles.section}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>Admin · User Feedback</h3>
        {hasResolved && (
          <button style={styles.clearBtn} onClick={clearResolved} disabled={clearing}>
            {clearing ? "Clearing…" : "Clear resolved"}
          </button>
        )}
      </div>
      <p style={styles.help}>
        Entries older than 30 days are deleted automatically. Resolve or delete entries any time.
      </p>
      {items.length === 0 && <p style={{ color: "#94a3b8", fontSize: 13 }}>No feedback yet.</p>}
      {items.map((item) => (
        <div key={item.id} style={styles.item}>
          <div style={styles.itemHeader}>
            <span style={styles.category}>{item.category}</span>
            <span style={styles.meta}>{item.username} · {item.source} · {new Date(item.created_at * 1000).toLocaleString()}</span>
            <span style={item.status === "resolved" ? styles.resolvedTag : styles.newTag}>{item.status}</span>
          </div>
          <p style={styles.message}>{item.message}</p>
          <div style={{ display: "flex", gap: 8 }}>
            {item.status !== "resolved" && (
              <button style={styles.actionBtn} onClick={() => resolve(item.id)} disabled={busyId === item.id}>
                Mark resolved
              </button>
            )}
            <button style={styles.deleteBtn} onClick={() => remove(item.id)} disabled={busyId === item.id}>
              Delete
            </button>
          </div>
        </div>
      ))}
      {error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}
    </section>
  );
}

const styles = {
  section: {
    background: "rgba(99, 102, 241, 0.07)", border: "1px solid rgba(129, 140, 248, 0.3)",
    borderRadius: 12, padding: 16, color: "#f8fafc",
  },
  help: { fontSize: 12, color: "#94a3b8", margin: "0 0 14px" },
  item: {
    background: "rgba(0, 0, 0, 0.2)", borderRadius: 10, padding: 12, marginBottom: 10,
    display: "flex", flexDirection: "column", gap: 8,
  },
  itemHeader: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, fontSize: 11 },
  category: {
    textTransform: "uppercase", fontWeight: 700, color: "#38bdf8", letterSpacing: "0.04em",
  },
  meta: { color: "#94a3b8" },
  newTag: {
    marginLeft: "auto", background: "rgba(248, 113, 113, 0.15)", color: "#fca5a5",
    padding: "2px 8px", borderRadius: 9999, fontWeight: 700,
  },
  resolvedTag: {
    marginLeft: "auto", background: "rgba(74, 222, 128, 0.15)", color: "#86efac",
    padding: "2px 8px", borderRadius: 9999, fontWeight: 700,
  },
  message: { fontSize: 13, color: "#e2e8f0", margin: 0, whiteSpace: "pre-wrap" },
  actionBtn: { padding: "6px 12px", border: 0, borderRadius: 7, background: "#4f46e5", color: "#fff", cursor: "pointer", fontSize: 12 },
  deleteBtn: {
    padding: "6px 12px", borderRadius: 7, cursor: "pointer", fontSize: 12,
    background: "rgba(248, 113, 113, 0.15)", color: "#fca5a5", border: "1px solid rgba(248, 113, 113, 0.3)",
  },
  clearBtn: {
    padding: "6px 12px", borderRadius: 7, cursor: "pointer", fontSize: 12,
    background: "rgba(248, 113, 113, 0.15)", color: "#fca5a5", border: "1px solid rgba(248, 113, 113, 0.3)",
  },
};
