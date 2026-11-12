import { useState } from "react";
import {
  analyzeResume, createResumePaymentOrder, downloadResumeVersion, getRebuildVersion,
  getResumeEntitlement, rebuildResume, verifyResumePayment,
} from "./resume-builder.mjs";

const API = import.meta.env.VITE_API_URL || "";
const notifyExpired = () => window.dispatchEvent(new Event("auth-expired"));

function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Unable to load Razorpay checkout"));
    document.head.appendChild(script);
  });
}

function scoreColor(score, max) {
  const ratio = score / max;
  if (ratio >= 0.8) return "#34d399";
  if (ratio >= 0.5) return "#fbbf24";
  return "#f87171";
}

// Shown from the existing "Resume & JD" tab via a "Check ATS Score" button — reuses whatever
// resume/JD text is already in those fields rather than asking the user to upload anything again.
export default function AtsScorePanel({ resume, jd, onClose }) {
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [rebuildStatus, setRebuildStatus] = useState("idle"); // idle | loading | done | error
  const [rebuildError, setRebuildError] = useState("");
  const [rebuilt, setRebuilt] = useState(null);
  const [entitlement, setEntitlement] = useState(null); // { active, entitlement_expires_at }
  const [payStatus, setPayStatus] = useState("idle"); // idle | loading | awaiting_utr | verifying | error
  const [payError, setPayError] = useState("");
  const [payOrder, setPayOrder] = useState(null);
  const [utrRef, setUtrRef] = useState("");
  const [downloadingFmt, setDownloadingFmt] = useState(""); // "pdf" | "docx" | ""
  const [downloadError, setDownloadError] = useState("");
  const [facts, setFacts] = useState({}); // category -> user-supplied text, answering facts_needed prompts

  async function runAnalysis() {
    setStatus("loading");
    setError("");
    try {
      const data = await analyzeResume(API, resume, jd, fetch, localStorage, notifyExpired);
      setResult(data);
      setStatus("done");
    } catch (e) {
      setError(e.message);
      setStatus("error");
    }
  }

  function factsAsText() {
    return Object.entries(facts)
      .filter(([, value]) => value.trim())
      .map(([category, value]) => `${category}: ${value.trim()}`)
      .join("\n");
  }

  async function runRebuild() {
    setRebuildStatus("loading");
    setRebuildError("");
    try {
      const data = await rebuildResume(
        API, resume, jd, result?.id ?? null, factsAsText(), fetch, localStorage, notifyExpired
      );
      setRebuilt(data);
      setRebuildStatus("done");
      getResumeEntitlement(API, fetch, localStorage, notifyExpired).then(setEntitlement).catch(() => {});
    } catch (e) {
      setRebuildError(e.message);
      setRebuildStatus("error");
    }
  }

  async function startPayment() {
    setPayStatus("loading");
    setPayError("");
    try {
      const order = await createResumePaymentOrder(API, fetch, localStorage, notifyExpired);
      setPayOrder(order);
      if (order.payment_mode === "test_utr") {
        setPayStatus("awaiting_utr");
        return;
      }
      await loadRazorpay();
      const checkout = new window.Razorpay({
        key: order.razorpay_key_id,
        amount: order.amount * 100,
        currency: "INR",
        name: "TechPrep",
        order_id: order.razorpay_order_id,
        handler: (payment) => verifyAndUnlock(order.order_id, {
          razorpay_payment_id: payment.razorpay_payment_id,
          razorpay_signature: payment.razorpay_signature,
        }),
      });
      checkout.on("payment.failed", (failure) => {
        setPayError(failure.error?.description || "Payment failed");
        setPayStatus("error");
      });
      setPayStatus("idle");
      checkout.open();
    } catch (e) {
      setPayError(e.message);
      setPayStatus("error");
    }
  }

  async function submitUtr(e) {
    e.preventDefault();
    if (!payOrder || !utrRef.trim()) return;
    await verifyAndUnlock(payOrder.order_id, { utr_ref: utrRef.trim() });
  }

  async function verifyAndUnlock(orderId, details) {
    setPayStatus("verifying");
    setPayError("");
    try {
      await verifyResumePayment(API, orderId, details, fetch, localStorage, notifyExpired);
      const updated = await getResumeEntitlement(API, fetch, localStorage, notifyExpired);
      setEntitlement(updated);
      if (rebuilt?.version_id) {
        const full = await getRebuildVersion(API, rebuilt.version_id, fetch, localStorage, notifyExpired);
        setRebuilt(full);
      }
      setPayStatus("done");
    } catch (e) {
      setPayError(e.message);
      setPayStatus("error");
    }
  }

  async function handleDownload(fmt) {
    setDownloadingFmt(fmt);
    setDownloadError("");
    try {
      await downloadResumeVersion(API, rebuilt.version_id, fmt, localStorage);
    } catch (e) {
      setDownloadError(e.message);
    } finally {
      setDownloadingFmt("");
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(event) => event.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={styles.title}>ATS Score</h3>
          <button style={styles.closeBtn} onClick={onClose} title="Close">✕</button>
        </div>
        <div style={styles.body}>
          {status === "idle" && (
            <>
              <p style={styles.hint}>
                Checks your resume (and job description, if filled in) against common ATS
                compatibility rules — formatting, keywords, experience, measurable achievements,
                summary, education and contact info.
              </p>
              {!resume?.trim() && (
                <p style={{ ...styles.hint, color: "#f87171" }}>
                  Add your resume text in this tab first, then run the check.
                </p>
              )}
              <button style={styles.primaryBtn} onClick={runAnalysis} disabled={!resume?.trim()}>
                Check ATS Score
              </button>
            </>
          )}

          {status === "loading" && <p style={styles.hint}>Scoring your resume…</p>}

          {status === "error" && (
            <>
              <p style={{ ...styles.hint, color: "#f87171" }}>{error}</p>
              <button style={styles.secondaryBtn} onClick={runAnalysis}>Try again</button>
            </>
          )}

          {status === "done" && result && (
            <>
              <div style={styles.overallRow}>
                <span style={styles.overallLabel}>Overall ATS Score</span>
                <span style={{ ...styles.overallScore, color: scoreColor(result.overall_score, result.overall_max) }}>
                  {result.overall_score}/{result.overall_max}
                </span>
              </div>

              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>ATS Evaluation Criteria</th>
                    <th style={{ ...styles.th, textAlign: "right" }}>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(result.breakdown).map((category) => (
                    <tr key={category.label}>
                      <td style={styles.td}>{category.label}</td>
                      <td style={{ ...styles.td, textAlign: "right", color: scoreColor(category.score, category.max), fontWeight: 700 }}>
                        {category.score}/{category.max}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ ...styles.td, fontWeight: 700, borderTop: "1px solid rgba(255,255,255,0.15)" }}>Total</td>
                    <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, borderTop: "1px solid rgba(255,255,255,0.15)" }}>
                      {result.overall_score}/{result.overall_max}
                    </td>
                  </tr>
                </tbody>
              </table>

              {result.issues.length > 0 && (
                <div style={styles.issuesBox}>
                  <h4 style={styles.issuesTitle}>Suggestions</h4>
                  <ul style={styles.issuesList}>
                    {result.issues.map((issue) => <li key={issue}>{issue}</li>)}
                  </ul>
                </div>
              )}

              {rebuildStatus !== "done" && result.facts_needed?.length > 0 && (
                <FactsForm asks={result.facts_needed} facts={facts} setFacts={setFacts} />
              )}

              <div style={styles.ctaRow}>
                <button style={styles.secondaryBtn} onClick={onClose}>Continue With Existing Resume — Free</button>
                {rebuildStatus !== "done" && (
                  <button
                    style={styles.primaryBtn}
                    onClick={runRebuild}
                    disabled={rebuildStatus === "loading"}
                  >
                    {rebuildStatus === "loading" ? "Rebuilding your resume…" : "Rebuild ATS-Friendly Resume"}
                  </button>
                )}
              </div>
              {rebuildStatus === "error" && (
                <p style={{ ...styles.hint, color: "#f87171" }}>{rebuildError}</p>
              )}
              {(rebuildStatus === "done" || rebuildStatus === "loading") && rebuilt && (
                <div style={styles.rebuildBox}>
                  <div style={styles.overallRow}>
                    <span style={styles.overallLabel}>Before → After</span>
                    <span style={styles.overallScore}>
                      <span style={{ color: scoreColor(rebuilt.original_score, rebuilt.overall_max) }}>
                        {rebuilt.original_score}
                      </span>
                      {" → "}
                      <span style={{ color: scoreColor(rebuilt.rebuilt_score, rebuilt.overall_max) }}>
                        {rebuilt.rebuilt_score}
                      </span>
                      /{rebuilt.overall_max}
                    </span>
                  </div>
                  <h4 style={styles.issuesTitle}>Rebuilt Summary</h4>
                  <p style={styles.hint}>{rebuilt.preview.summary}</p>
                  {rebuilt.preview.experience?.length > 0 && (
                    <>
                      <h4 style={styles.issuesTitle}>Rebuilt Experience</h4>
                      {rebuilt.preview.experience.map((job, i) => (
                        <div key={i} style={{ marginBottom: 8 }}>
                          <p style={{ ...styles.hint, fontWeight: 700, color: "#e2e8f0" }}>
                            {job.title} — {job.company} ({job.dates})
                          </p>
                          <ul style={styles.issuesList}>
                            {job.bullets.map((bullet, j) => (
                              <li key={j} style={bullet.startsWith("🔒") ? styles.lockedBullet : undefined}>
                                {bullet}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </>
                  )}
                  {rebuilt.locked && (
                    <p style={{ ...styles.hint, color: "#fbbf24" }}>
                      🔒 This is a preview. Pay ₹10 to unlock the full rewritten resume text and
                      download the formatted PDF/DOCX — unlimited for 24 hours.
                    </p>
                  )}
                  {!rebuilt.locked && (
                    <p style={styles.disclaimer}>
                      Unlocked — you can copy this text freely and download the formatted PDF/DOCX
                      below for 24 hours.
                    </p>
                  )}

                  {rebuilt.facts_needed?.length > 0 && rebuilt.rebuilt_score < rebuilt.target_score && (
                    <>
                      <p style={{ ...styles.hint, color: "#fbbf24" }}>
                        Score is {rebuilt.rebuilt_score}/{rebuilt.overall_max} — still below the
                        {" "}{rebuilt.target_score}+ target. Answer these to let the AI close the gap
                        (it will never invent facts you don't confirm):
                      </p>
                      <FactsForm asks={rebuilt.facts_needed} facts={facts} setFacts={setFacts} />
                      <button
                        style={styles.secondaryBtn}
                        onClick={runRebuild}
                        disabled={rebuildStatus === "loading"}
                      >
                        {rebuildStatus === "loading" ? "Rebuilding…" : "Rebuild Again With These Details"}
                      </button>
                    </>
                  )}

                  {entitlement?.active ? (
                    <div style={styles.downloadRow}>
                      <button
                        style={styles.secondaryBtn}
                        onClick={() => handleDownload("pdf")}
                        disabled={downloadingFmt === "pdf"}
                      >
                        {downloadingFmt === "pdf" ? "Downloading…" : "⬇ Download PDF"}
                      </button>
                      <button
                        style={styles.secondaryBtn}
                        onClick={() => handleDownload("docx")}
                        disabled={downloadingFmt === "docx"}
                      >
                        {downloadingFmt === "docx" ? "Downloading…" : "⬇ Download DOCX"}
                      </button>
                    </div>
                  ) : payStatus === "awaiting_utr" ? (
                    <form onSubmit={submitUtr} style={styles.downloadRow}>
                      <input
                        style={styles.utrInput}
                        placeholder="12-digit UTR"
                        value={utrRef}
                        onChange={(e) => setUtrRef(e.target.value)}
                      />
                      <button style={styles.primaryBtn} type="submit" disabled={payStatus === "verifying"}>
                        Confirm Payment
                      </button>
                    </form>
                  ) : (
                    <button
                      style={styles.primaryBtn}
                      onClick={startPayment}
                      disabled={payStatus === "loading" || payStatus === "verifying"}
                    >
                      {payStatus === "verifying" ? "Verifying payment…" : "Pay ₹10 to Unlock Full Resume & Downloads (24h)"}
                    </button>
                  )}
                  {payStatus === "error" && (
                    <p style={{ ...styles.hint, color: "#f87171" }}>{payError}</p>
                  )}
                  {downloadError && (
                    <p style={{ ...styles.hint, color: "#f87171" }}>{downloadError}</p>
                  )}
                </div>
              )}
              <p style={styles.disclaimer}>
                This is an estimated, app-defined compatibility score, not a guarantee of how any
                specific employer's ATS will rank your resume.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Renders one small labelled textarea per category still below resume_builder.TARGET_SCORE,
// so the user supplies exactly the real facts (metrics, dates, contact info) the AI is not
// allowed to invent — instead of one vague freeform box.
function FactsForm({ asks, facts, setFacts }) {
  return (
    <div style={styles.factsBox}>
      {asks.map((ask) => (
        <label key={ask.category} style={styles.factsLabel}>
          {ask.label}
          <textarea
            style={styles.factsInput}
            rows={2}
            placeholder={ask.prompt}
            value={facts[ask.category] || ""}
            onChange={(e) => setFacts((prev) => ({ ...prev, [ask.category]: e.target.value }))}
          />
        </label>
      ))}
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0, 0, 0, 0.6)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100,
  },
  modal: {
    width: 480, maxWidth: "92vw", maxHeight: "85vh", overflowY: "auto",
    background: "#10131d", border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: 14, color: "#f8fafc", boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5)",
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "16px 18px", borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
  },
  title: { margin: 0, fontSize: 16, fontWeight: 700 },
  closeBtn: { background: "transparent", border: "none", color: "#94a3b8", fontSize: 16, cursor: "pointer" },
  body: { display: "flex", flexDirection: "column", gap: 14, padding: 18 },
  hint: { color: "#cbd5e1", margin: 0, fontSize: 13 },
  primaryBtn: {
    background: "linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)", color: "#080a11", border: "none",
    padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer",
  },
  secondaryBtn: {
    background: "transparent", color: "#cbd5e1", border: "1px solid #334155",
    padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
  },
  overallRow: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    background: "rgba(255, 255, 255, 0.05)", borderRadius: 10, padding: "10px 14px",
  },
  overallLabel: { fontSize: 13.5, fontWeight: 600, color: "#e2e8f0" },
  overallScore: { fontSize: 18, fontWeight: 800 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "6px 4px", color: "#94a3b8", fontWeight: 600, fontSize: 12 },
  td: { padding: "6px 4px", color: "#e2e8f0" },
  issuesBox: { background: "rgba(251, 191, 36, 0.08)", border: "1px solid rgba(251, 191, 36, 0.2)", borderRadius: 10, padding: 12 },
  issuesTitle: { margin: "0 0 6px", fontSize: 13, fontWeight: 700, color: "#fbbf24" },
  issuesList: { margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#e2e8f0", display: "flex", flexDirection: "column", gap: 4 },
  ctaRow: { display: "flex", flexDirection: "column", gap: 8 },
  rebuildBox: {
    background: "rgba(99, 102, 241, 0.08)", border: "1px solid rgba(99, 102, 241, 0.25)",
    borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 6,
  },
  downloadRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  utrInput: {
    flex: 1, minWidth: 120, background: "#0b0e16", border: "1px solid #334155", borderRadius: 8,
    color: "#f8fafc", padding: "8px 10px", fontSize: 13,
  },
  disclaimer: { margin: 0, fontSize: 11, color: "#64748b" },
  lockedBullet: { color: "#94a3b8", fontStyle: "italic" },
  factsBox: {
    background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10,
  },
  factsLabel: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 600, color: "#e2e8f0" },
  factsInput: {
    background: "#0b0e16", border: "1px solid #334155", borderRadius: 8, color: "#f8fafc",
    padding: "8px 10px", fontSize: 12.5, fontWeight: 400, resize: "vertical", fontFamily: "inherit",
  },
};
