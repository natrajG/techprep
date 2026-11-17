import { useEffect, useState } from "react";
import { fetchInterviewHistory, deleteInterviewHistoryItem, clearInterviewHistory } from "./history.mjs";
import { splitBold } from "./rich-text.mjs";
import Dialog from "./Dialog";
import Icon from "./Icon";

const API = import.meta.env.VITE_API_URL || "";
const notifyExpired = () => window.dispatchEvent(new Event("auth-expired"));
const PAGE_SIZE = 20;

export default function InterviewHistory({ onClose = null, inModal = false }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [expandedId, setExpandedId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    fetchInterviewHistory(API, query, PAGE_SIZE, page * PAGE_SIZE, fetch, localStorage, notifyExpired)
      .then((data) => {
        if (!active) return;
        if (page > 0 && data.total > 0 && data.items.length === 0) {
          setPage(Math.ceil(data.total / PAGE_SIZE) - 1);
          return;
        }
        setItems(data.items);
        setTotal(data.total);
        setExpandedId(null);
      })
      .catch((e) => {
        if (active) setError(e.message || "Failed to load interview history");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [query, page, refresh]);

  function handleSearchSubmit(e) {
    e.preventDefault();
    setPage(0);
    setQuery(search.trim());
    setRefresh((value) => value + 1);
  }

  async function confirmAction() {
    if (!pendingAction || deleting) return;
    setDeleting(true);
    setError("");
    try {
      if (pendingAction.type === "clear") {
        await clearInterviewHistory(API, fetch, localStorage, notifyExpired);
        setPage(0);
      } else {
        await deleteInterviewHistoryItem(API, pendingAction.id, fetch, localStorage, notifyExpired);
        if (items.length === 1 && page > 0) setPage(page - 1);
      }
      setPendingAction(null);
      setRefresh((value) => value + 1);
    } catch (err) {
      setError(`Could not ${pendingAction.type === "clear" ? "clear history" : "delete question"}: ${err.message}`);
      setPendingAction(null);
    } finally {
      setDeleting(false);
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
      <div className="tp-history-header" style={styles.header}>
        <div>
          <span className="tp-eyebrow">YOUR QUESTION LIBRARY</span>
          <h2 style={{ ...styles.title, marginTop: 8 }}>Interview History &amp; Question Prep</h2>
          <p style={styles.subtitle}>
            Revisit your questions. Refine your answers. Feel more ready for the next conversation.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!loading && total > 0 && (
            <button style={styles.clearBtn} onClick={() => setPendingAction({ type: "clear" })} title="Clear all saved questions">
              Clear all
            </button>
          )}
          {onClose && (
            <button className="tp-btn" onClick={onClose} aria-label="Close interview history">
              <Icon name="close" size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Search & Stats Bar */}
      <div style={styles.toolbar}>
        <form onSubmit={handleSearchSubmit} className="tp-history-toolbar" style={{ flex: 1 }}>
          <input
            type="text"
            style={styles.searchInput}
            placeholder="Search questions or answers (e.g. React, System Design, SQL)..."
            aria-label="Search interview history"
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
                setQuery("");
                setPage(0);
                setRefresh((value) => value + 1);
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

      {error && <div role="alert" style={styles.errorBox}>⚠️ {error}</div>}

      {/* Loading state */}
      {loading && <div style={styles.mutedText}>Loading interview history…</div>}

      {/* Empty state */}
      {!loading && !error && items.length === 0 && (
        <div style={styles.emptyCard}>
          <div style={{ color: "#bba8eb", marginBottom: 16 }}><Icon name="history" size={32} /></div>
          <h3 style={{ margin: "0 0 6px", color: "#f8fafc" }}>
            {query ? "No matching questions" : "No Interview Questions Saved Yet"}
          </h3>
          <p style={{ margin: 0, color: "#94a3b8", fontSize: 13, maxWidth: 500 }}>
            {query
              ? "Try a different search term or reset the search to see all saved questions."
              : "Start an interview call in the TechPrep desktop app or use the question box. Every question asked by your interviewer and answered by the AI copilot will be automatically stored here for review and next-interview preparation."}
          </p>
        </div>
      )}

      {/* Q&A List */}
      {!loading && !error && items.length > 0 && (
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
              <div key={item.id} style={styles.card}>
                <div className="tp-history-item-header" style={styles.cardHeader}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                    <span style={styles.qBadge}>Q{total - page * PAGE_SIZE - idx}</span>
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
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingAction({ type: "delete", id: item.id, question: item.question });
                      }}
                      aria-label={`Delete ${item.question}`}
                      title="Delete this question"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Answer Preview or Full Answer */}
                <div style={styles.answerBox}>
                  <div style={styles.answerHeader}>
                    <span style={styles.answerLabel}>Copilot answer</span>
                    <button className="tp-btn tp-btn-text" style={{ fontSize: 12, padding: "4px 8px" }}
                      aria-expanded={isExpanded} aria-controls={`history-answer-${item.id}`}
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}>{isExpanded ? "Collapse" : "Expand answer"}</button>
                  </div>
                  <pre id={`history-answer-${item.id}`} style={isExpanded ? styles.preFull : styles.preCollapsed}>
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
      {!loading && !error && total > PAGE_SIZE && (
        <nav style={styles.pagination} aria-label="Interview history pages">
          <button style={styles.resetBtn} disabled={page === 0} onClick={() => setPage((value) => value - 1)}>
            ← Previous
          </button>
          <span>Page {page + 1} of {Math.ceil(total / PAGE_SIZE)} · {total} questions</span>
          <button style={styles.resetBtn} disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((value) => value + 1)}>
            Next →
          </button>
        </nav>
      )}
      {pendingAction && (
        <Dialog label={pendingAction.type === "clear" ? "Clear interview history?" : "Delete this question?"}
          onClose={() => { if (!deleting) setPendingAction(null); }} style={{ maxWidth: 480 }}>
            <h3 id="history-confirm-title" style={styles.confirmTitle}>
              {pendingAction.type === "clear" ? "Clear interview history?" : "Delete this question?"}
            </h3>
            <p id="history-confirm-description" style={styles.subtitle}>
              {pendingAction.type === "clear"
                ? "This will permanently remove all saved questions and answers, including those outside the current search. This cannot be undone."
                : <>“{pendingAction.question}” and its answer will be permanently removed. This cannot be undone.</>}
            </p>
            <div style={styles.confirmActions}>
              <button style={styles.closeBtn} disabled={deleting} onClick={() => setPendingAction(null)} autoFocus>Cancel</button>
              <button style={styles.clearBtn} disabled={deleting} onClick={confirmAction}>
                {deleting ? "Deleting…" : pendingAction.type === "clear" ? "Clear all history" : "Delete question"}
              </button>
            </div>
        </Dialog>
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
    color: "#aaa4bc",
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
    color: "#d3cedf",
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
    background: "#101119",
    color: "#fff",
    fontSize: 13,
  },
  searchBtn: {
    padding: "9px 16px",
    borderRadius: 8,
    border: 0,
    background: "#7058db",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  resetBtn: {
    padding: "9px 14px",
    borderRadius: 8,
    border: "1px solid #475569",
    background: "#24212e",
    color: "#d3cedf",
    fontSize: 13,
    cursor: "pointer",
  },
  pagination: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
    color: "#d3cedf",
    fontSize: 13,
  },
  confirmTitle: { margin: 0, color: "#f8fafc", fontSize: 18 },
  confirmActions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 },
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
    color: "#aaa4bc",
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
    background: "#14141e",
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
    color: "#aaa4bc",
  },
  copyBtn: {
    padding: "4px 8px",
    borderRadius: 6,
    border: "1px solid rgba(255, 255, 255, 0.12)",
    background: "rgba(255, 255, 255, 0.06)",
    color: "#d3cedf",
    fontSize: 11,
    cursor: "pointer",
  },
  deleteBtn: {
    padding: "4px 8px",
    borderRadius: 6,
    border: 0,
    background: "transparent",
    color: "#9890ab",
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
    color: "#b3a3fa",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  preCollapsed: {
    margin: 0,
    fontFamily: "inherit",
    fontSize: 13.5,
    color: "#d3cedf",
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
