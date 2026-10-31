import { useEffect, useState } from "react";
import { fetchInterviewHistory, deleteInterviewHistoryItem, clearInterviewHistory } from "./history.mjs";
import { splitBold } from "./rich-text.mjs";

const API = import.meta.env.VITE_API_URL || "";
const notifyExpired = () => window.dispatchEvent(new Event("auth-expired"));

export default function InterviewHistory({ onClose = null, inModal = false }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  function loadData(query = search) {
    setLoading(true);
    setError("");
    fetchInterviewHistory(API, query, 100, 0, fetch, localStorage, notifyExpired)
      .then((data) => {
        setItems(data.items || []);
        setTotal(data.total || 0);
      })
      .catch((e) => setError(e.message || "Failed to load interview history"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadData();
  }, []);

  function handleSearchSubmit(e) {
    e.preventDefault();
    loadData(search);
  }

  async function handleDelete(id, e) {
    e.stopPropagation();
    if (!window.confirm("Delete this question from your interview history?")) return;
    try {
      await deleteInterviewHistoryItem(API, id, fetch, localStorage, notifyExpired);
      setItems((prev) => prev.filter((item) => item.id !== id));
      setTotal((t) => Math.max(0, t - 1));
    } catch (err) {
      alert(`Could not delete item: ${err.message}`);
    }
  }

  async function handleClearAll() {
    if (!window.confirm("Clear all recorded interview questions and answers? This cannot be undone.")) return;
    try {
      await clearInterviewHistory(API, fetch, localStorage, notifyExpired);
      setItems([]);
      setTotal(0);
    } catch (err) {
      alert(`Could not clear history: ${err.message}`);
    }
  }

  function copyQA(item, e) {
    e.stopPropagation();
    const text = `Q: ${item.question}\n\nA: ${item.answer}`;
    navigator.clipboard?.writeText(text);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div style={inModal ? styles.modalContent : styles.container}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>📚 Interview History &amp; Question Prep</h2>
          <p style={styles.subtitle}>
            All questions and AI-generated answers from your live sessions are automatically preserved here so you can analyze your performance and prepare for your next interview.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {items.length > 0 && (
            <button style={styles.clearBtn} onClick={handleClearAll} title="Clear all saved questions">
              🗑️ Clear All
            </button>
          )}
          {onClose && (
            <button style={styles.closeBtn} onClick={onClose} aria-label="Close">
              ✕ Close
            </button>
          )}
        </div>
      </div>

      {/* Search & Stats Bar */}
      <div style={styles.toolbar}>
        <form onSubmit={handleSearchSubmit} style={{ display: "flex", gap: 8, flex: 1 }}>
          <input
            type="text"
            style={styles.searchInput}
            placeholder="Search questions or answers (e.g. React, System Design, SQL)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" style={styles.searchBtn}>
            Search
          </button>
          {search && (
            <button
              type="button"
              style={styles.resetBtn}
              onClick={() => {
                setSearch("");
                loadData("");
              }}
            >
              Reset
            </button>
          )}
        </form>
        <div style={styles.statPill}>
          <strong>{total}</strong> Question{total === 1 ? "" : "s"} Saved
        </div>
      </div>

      {error && <div style={styles.errorBox}>⚠️ {error}</div>}

      {/* Loading state */}
      {loading && <div style={styles.mutedText}>Loading interview history…</div>}

      {/* Empty state */}
      {!loading && items.length === 0 && (
        <div style={styles.emptyCard}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🎯</div>
          <h3 style={{ margin: "0 0 6px", color: "#f8fafc" }}>No Interview Questions Saved Yet</h3>
          <p style={{ margin: 0, color: "#94a3b8", fontSize: 13, maxWidth: 500 }}>
            Start an interview call in the TechPrep desktop app or use the question box. Every question asked by your interviewer and answered by the AI copilot will be automatically stored here for review and next-interview preparation.
          </p>
        </div>
      )}

      {/* Q&A List */}
      {!loading && items.length > 0 && (
        <div style={styles.list}>
          {items.map((item, idx) => {
            const isExpanded = expandedId === item.id;
            const dateStr = item.created_at
              ? new Date(item.created_at * 1000).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })
              : "";
            return (
              <div key={item.id} style={styles.card} onClick={() => setExpandedId(isExpanded ? null : item.id)}>
                <div style={styles.cardHeader}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                    <span style={styles.qBadge}>Q{items.length - idx}</span>
                    <strong style={styles.qText}>{item.question}</strong>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <span style={styles.dateBadge}>{dateStr}</span>
                    <button
                      style={styles.copyBtn}
                      onClick={(e) => copyQA(item, e)}
                      title="Copy Question & Answer"
                    >
                      {copiedId === item.id ? "✓ Copied" : "📋 Copy"}
                    </button>
                    <button
                      style={styles.deleteBtn}
                      onClick={(e) => handleDelete(item.id, e)}
                      title="Delete this question"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Answer Preview or Full Answer */}
                <div style={styles.answerBox}>
                  <div style={styles.answerHeader}>
                    <span style={styles.answerLabel}>⭐ Copilot Answer</span>
                    <span style={{ fontSize: 11, color: "#818cf8" }}>{isExpanded ? "▲ Collapse" : "▼ Expand full"}</span>
                  </div>
                  <pre style={isExpanded ? styles.preFull : styles.preCollapsed}>
                    {splitBold(item.answer).map((part, i) =>
                      part.bold ? <strong key={i}>{part.text}</strong> : part.text
                    )}
                  </pre>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    width: "100%",
  },
  modalContent: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    width: "100%",
    maxHeight: "80vh",
    overflowY: "auto",
    paddingRight: 6,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    flexWrap: "wrap",
  },
  title: {
    margin: 0,
    fontSize: 20,
    fontWeight: 700,
    color: "#f8fafc",
    letterSpacing: "-0.02em",
  },
  subtitle: {
    margin: "6px 0 0",
    fontSize: 13,
    color: "#94a3b8",
    maxWidth: 680,
    lineHeight: 1.5,
  },
  clearBtn: {
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid rgba(248, 113, 113, 0.3)",
    background: "rgba(248, 113, 113, 0.1)",
    color: "#fca5a5",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  closeBtn: {
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid rgba(255, 255, 255, 0.15)",
    background: "rgba(255, 255, 255, 0.08)",
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  toolbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  searchInput: {
    flex: 1,
    minWidth: 260,
    padding: "9px 14px",
    borderRadius: 8,
    border: "1px solid #334155",
    background: "#0f172a",
    color: "#fff",
    fontSize: 13,
  },
  searchBtn: {
    padding: "9px 16px",
    borderRadius: 8,
    border: 0,
    background: "#4f46e5",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  resetBtn: {
    padding: "9px 14px",
    borderRadius: 8,
    border: "1px solid #475569",
    background: "#1e293b",
    color: "#cbd5e1",
    fontSize: 13,
    cursor: "pointer",
  },
  statPill: {
    padding: "7px 14px",
    borderRadius: 9999,
    background: "rgba(99, 102, 241, 0.15)",
    border: "1px solid rgba(99, 102, 241, 0.3)",
    color: "#a5b4fc",
    fontSize: 12,
  },
  errorBox: {
    padding: "10px 14px",
    borderRadius: 8,
    background: "rgba(239, 68, 68, 0.15)",
    border: "1px solid rgba(239, 68, 68, 0.4)",
    color: "#fca5a5",
    fontSize: 13,
  },
  mutedText: {
    color: "#94a3b8",
    fontSize: 13,
    padding: "20px 0",
    textAlign: "center",
  },
  emptyCard: {
    padding: "40px 20px",
    borderRadius: 12,
    border: "1px dashed rgba(255, 255, 255, 0.15)",
    background: "rgba(255, 255, 255, 0.02)",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  card: {
    padding: "14px 16px",
    borderRadius: 12,
    background: "rgba(15, 23, 42, 0.8)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    cursor: "pointer",
    transition: "border-color 0.2s ease, background 0.2s ease",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  qBadge: {
    padding: "3px 8px",
    borderRadius: 6,
    background: "rgba(129, 140, 248, 0.2)",
    color: "#a5b4fc",
    fontWeight: 700,
    fontSize: 11,
    flexShrink: 0,
  },
  qText: {
    color: "#f8fafc",
    fontSize: 14.5,
    lineHeight: 1.4,
  },
  dateBadge: {
    fontSize: 11,
    color: "#94a3b8",
  },
  copyBtn: {
    padding: "4px 8px",
    borderRadius: 6,
    border: "1px solid rgba(255, 255, 255, 0.12)",
    background: "rgba(255, 255, 255, 0.06)",
    color: "#cbd5e1",
    fontSize: 11,
    cursor: "pointer",
  },
  deleteBtn: {
    padding: "4px 8px",
    borderRadius: 6,
    border: 0,
    background: "transparent",
    color: "#64748b",
    fontSize: 12,
    cursor: "pointer",
  },
  answerBox: {
    marginTop: 10,
    paddingTop: 10,
    borderTop: "1px solid rgba(255, 255, 255, 0.06)",
  },
  answerHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  answerLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "#818cf8",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  preCollapsed: {
    margin: 0,
    fontFamily: "inherit",
    fontSize: 13.5,
    color: "#cbd5e1",
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    maxHeight: 70,
    overflow: "hidden",
    textOverflow: "ellipsis",
    position: "relative",
    maskImage: "linear-gradient(to bottom, black 60%, transparent 100%)",
  },
  preFull: {
    margin: 0,
    fontFamily: "inherit",
    fontSize: 13.5,
    color: "#e2e8f0",
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    background: "rgba(0, 0, 0, 0.3)",
    padding: 12,
    borderRadius: 8,
    borderLeft: "3px solid #818cf8",
  },
};
