import { useEffect, useState } from "react";
import Dialog from "./Dialog";
import Icon from "./Icon";
import {
  analyzeResume, createResumePaymentOrder, downloadResumeVersion, getRebuildVersion,
  getResumeEntitlement, rebuildResume, verifyResumePayment,
} from "./resume-builder.mjs";

const API = import.meta.env.VITE_API_URL || "";
const notifyExpired = () => window.dispatchEvent(new Event("auth-expired"));
const ATS_GATE_STORAGE_KEY = "ats_gate";

function resumeFingerprint(text) {
  const source = (text || "").trim();
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
  }
  return `${source.length}:${Math.abs(hash)}`;
}

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
export default function AtsScorePanel({
  resume,
  jd,
  uploadedResume = Boolean(localStorage.getItem("resume_uploaded_at")),
  requireUploadedResume = false,
  onClose,
}) {
  const [status, setStatus] = useState("idle"); // idle | loading | done | error
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [rebuildStatus, setRebuildStatus] = useState("idle"); // idle | loading | done | error
  const [rebuildError, setRebuildError] = useState("");
  const [rebuilt, setRebuilt] = useState(null);
  const [entitlement, setEntitlement] = useState(null); // { active, entitlement_expires_at }
  const [payStatus, setPayStatus] = useState("idle"); // idle | loading | verifying | done | error
  const [payError, setPayError] = useState("");
  const [downloadingFmt, setDownloadingFmt] = useState(""); // "pdf" | "docx" | "rtf" | "doc" | ""
  const [downloadError, setDownloadError] = useState("");
  const [facts, setFacts] = useState({}); // category -> user-supplied text, answering facts_needed prompts

  async function runAnalysis() {
    const trimmedResume = (resume || "").trim();
    if (!trimmedResume) {
      setError("Upload your resume PDF first, then run ATS score.");
      setStatus("error");
      return;
    }
    if (requireUploadedResume && !uploadedResume) {
      setError("Resume upload is required before ATS scoring.");
      setStatus("error");
      return;
    }
    if (trimmedResume.length < 80 || trimmedResume.split(/\s+/).length < 15) {
      setError("Resume text looks too short. Upload a full resume PDF before ATS scoring.");
      setStatus("error");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const data = await analyzeResume(API, trimmedResume, jd, fetch, localStorage, notifyExpired);
      setResult(data);
      localStorage.setItem(
        ATS_GATE_STORAGE_KEY,
        JSON.stringify({
          fingerprint: resumeFingerprint(trimmedResume),
          score: data.overall_score,
          max: data.overall_max,
          updatedAt: Date.now(),
        }),
      );
      window.dispatchEvent(new Event("ats-updated"));
      setStatus("done");
    } catch (e) {
      setError(e.message);
      setStatus("error");
    }
  }

  useEffect(() => {
    if (resume?.trim()) {
      runAnalysis();
    }
  }, []);

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
      localStorage.setItem(
        ATS_GATE_STORAGE_KEY,
        JSON.stringify({
          fingerprint: resumeFingerprint(resume),
          score: data.rebuilt_score,
          max: data.overall_max,
          updatedAt: Date.now(),
        }),
      );
      window.dispatchEvent(new Event("ats-updated"));
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
    <Dialog label="Free ATS score and analysis" onClose={onClose} style={{ maxWidth: 600 }}>
        <div className="tp-dialog-heading">
          <div><span className="tp-eyebrow">YOUR EXPERIENCE, IN FOCUS</span><h2>Free ATS score &amp; analysis</h2></div>
          <button className="tp-btn" onClick={onClose} aria-label="Close ATS analysis"><Icon name="close" size={18} /></button>
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
              <button className="tp-btn tp-btn-primary" onClick={runAnalysis} disabled={!resume?.trim()}>
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
                    {rebuildStatus === "loading" ? "Rebuilding your resume…" : "Rebuild ATS-Friendly Resume (Preview Free • Unlock ₹10)"}
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
                  {rebuilt.changes?.category_deltas?.length > 0 && (
                    <>
                      <h4 style={styles.issuesTitle}>What Changed — Score Breakdown</h4>
                      <ul style={styles.issuesList}>
                        {rebuilt.changes.category_deltas.map((d) => (
                          <li key={d.category}>
                            {d.label}: {d.before} → {d.after} / {d.max}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {rebuilt.changes?.bullet_diffs?.length > 0 && (
                    <>
                      <h4 style={styles.issuesTitle}>What Changed — Rewritten Bullets</h4>
                      {rebuilt.changes.bullet_diffs.map((d, i) => (
                        <div key={i} style={{ marginBottom: 8 }}>
                          <p style={{ ...styles.hint, fontWeight: 700, color: "#e2e8f0" }}>{d.job}</p>
                          {d.before && (
                            <p style={{ ...styles.hint, color: "#f87171", margin: "2px 0" }}>− {d.before}</p>
                          )}
                          <p style={{ ...styles.hint, color: "#34d399", margin: "2px 0" }}>
                            {d.type === "added" ? "+ (new) " : "+ "}{d.after}
                          </p>
                        </div>
                      ))}
                    </>
                  )}
                  {rebuilt.locked && rebuilt.changes?.bullet_diff_count > 0 && (
                    <p style={{ ...styles.hint, color: "#fbbf24" }}>
                      🔒 {rebuilt.changes.bullet_diff_count} bullet{rebuilt.changes.bullet_diff_count === 1 ? "" : "s"} were
                      rewritten — unlock to see the exact before/after text for each one.
                    </p>
                  )}
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
                      <button
                        style={styles.secondaryBtn}
                        onClick={() => handleDownload("rtf")}
                        disabled={downloadingFmt === "rtf"}
                      >
                        {downloadingFmt === "rtf" ? "Downloading…" : "⬇ Download RTF"}
                      </button>
                      <button
                        style={styles.secondaryBtn}
                        onClick={() => handleDownload("doc")}
                        disabled={downloadingFmt === "doc"}
                      >
                        {downloadingFmt === "doc" ? "Downloading…" : "⬇ Download DOC"}
                      </button>
                    </div>
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
    </Dialog>
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
          {ask.category === "achievements" && (
            <small style={styles.factsHint}>
              Add real outcomes you can verify — for example:
              {" "}“Reduced API latency by 35%”, “Resolved 120+ tickets/month”, “Maintained 99.9% uptime”,
              {" "}“Employee of the Year 2024”, “Top Performer Q2”.
            </small>
          )}
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
  body: { display: "flex", flexDirection: "column", gap: 14, padding: 18 },
  hint: { color: "#d3cedf", margin: 0, fontSize: 13 },
  primaryBtn: {
    background: "#7058db", color: "#ffffff", border: "none",
    padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer",
  },
  secondaryBtn: {
    background: "transparent", color: "#d3cedf", border: "1px solid #334155",
    padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
  },
  overallRow: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    background: "rgba(255, 255, 255, 0.05)", borderRadius: 10, padding: "10px 14px",
  },
  overallLabel: { fontSize: 13.5, fontWeight: 600, color: "#e2e8f0" },
  overallScore: { fontSize: 18, fontWeight: 800 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "6px 4px", color: "#aaa4bc", fontWeight: 600, fontSize: 12 },
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
  disclaimer: { margin: 0, fontSize: 11, color: "#9890ab" },
  lockedBullet: { color: "#aaa4bc", fontStyle: "italic" },
  factsBox: {
    background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10,
  },
  factsLabel: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 600, color: "#e2e8f0" },
  factsHint: { color: "#fcd34d", fontSize: 11.5, fontWeight: 500, lineHeight: 1.6 },
  factsInput: {
    background: "#0b0e16", border: "1px solid #334155", borderRadius: 8, color: "#f8fafc",
    padding: "8px 10px", fontSize: 12.5, fontWeight: 400, resize: "vertical", fontFamily: "inherit",
  },
};
