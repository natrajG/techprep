import { useEffect, useRef, useState } from "react";
import { createPaymentOrder, fetchPlans, uploadCustomQr, verifyPayment } from "./subscriptions.mjs";
import { makeQrSvg } from "./qr.mjs";

const API = import.meta.env.VITE_API_URL || "";

export default function SubscriptionPricing({ currentSubscription, onPaymentSuccess, onClose, allowQrUpload = false }) {
  const [plans, setPlans] = useState([]);
  const [customQrUrl, setCustomQrUrl] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState("hourly_call");
  const [order, setOrder] = useState(null);
  const [utrRef, setUtrRef] = useState("");
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [uploadingQr, setUploadingQr] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetchPlans(API)
      .then((data) => {
        setPlans(data.plans || []);
        if (data.custom_qr_available && data.custom_qr_url) {
          setCustomQrUrl(`${API}${data.custom_qr_url}?t=${Date.now()}`);
        }
      })
      .catch((e) => setError("Failed to load plans: " + e.message));
  }, []);

  async function handleQrFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingQr(true);
    setError("");
    try {
      const res = await uploadCustomQr(API, file);
      setCustomQrUrl(`${API}${res.url}?t=${Date.now()}`);
    } catch (err) {
      setError("Failed to upload QR: " + err.message);
    } finally {
      setUploadingQr(false);
    }
  }

  async function handleSelectPlan(planId) {
    setSelectedPlan(planId);
    setLoading(true);
    setError("");
    setOrder(null);
    try {
      const orderData = await createPaymentOrder(API, planId);
      setOrder(orderData);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Auto initialize order on mount
  useEffect(() => {
    if (!order && !loading) {
      handleSelectPlan("hourly_call");
    }
  }, []);

  async function handleVerify(e) {
    e.preventDefault();
    if (!order || !utrRef.trim()) return;
    setVerifying(true);
    setError("");
    try {
      const res = await verifyPayment(API, order.order_id, utrRef.trim());
      setSuccessMessage(res.message || "Payment verified! Your access is unlocked.");
      setTimeout(() => {
        if (onPaymentSuccess) onPaymentSuccess();
      }, 1500);
    } catch (e) {
      setError(e.message);
    } finally {
      setVerifying(false);
    }
  }

  function copyUpiUri() {
    if (!order) return;
    navigator.clipboard?.writeText(order.upi_uri || order.upi_vpa);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <div style={styles.header}>
          <span style={styles.badge}>INSTANT UPI ACTIVATION</span>
          <h2 style={styles.title}>Unlock TechPrep Pro</h2>
          <p style={styles.subtitle}>
            Industry-leading stealth interview intelligence at a fraction of US competitor prices.
          </p>
        </div>

        {currentSubscription?.status === "active" && (
          <div style={styles.activeBanner}>
            ✓ You have an active subscription: <strong>{currentSubscription.plan_name}</strong>
            {currentSubscription.time_remaining_seconds && (
              <span> ({Math.ceil(currentSubscription.time_remaining_seconds / 60)} mins remaining)</span>
            )}
          </div>
        )}

        {/* Plan Cards */}
        <div style={styles.plansGrid}>
          {/* Hourly Card */}
          <div
            onClick={() => handleSelectPlan("hourly_call")}
            style={{
              ...styles.planCard,
              ...(selectedPlan === "hourly_call" ? styles.planCardSelected : {}),
            }}
          >
            <div style={styles.planBadge}>POPULAR FOR INTERVIEWS</div>
            <h3 style={styles.planName}>Single Call / 1-Hour</h3>
            <div style={styles.priceRow}>
              <span style={styles.currency}>₹</span>
              <span style={styles.amount}>199</span>
              <span style={styles.term}>/ call</span>
            </div>
            <ul style={styles.featureList}>
              <li>✓ <strong>1 Hour continuous assistance</strong></li>
              <li>✓ Reconnect protection (same 1-hr window)</li>
              <li>✓ Real-time loopback audio transcription</li>
              <li>✓ Stealth capture-protection HUD</li>
            </ul>
          </div>

          {/* Monthly Card */}
          <div
            onClick={() => handleSelectPlan("monthly")}
            style={{
              ...styles.planCard,
              ...(selectedPlan === "monthly" ? styles.planCardSelected : {}),
            }}
          >
            <div style={{ ...styles.planBadge, background: "rgba(234, 179, 8, 0.2)", color: "#facc15" }}>
              BEST VALUE FOR JOB SEARCH
            </div>
            <h3 style={styles.planName}>Monthly Unlimited</h3>
            <div style={styles.priceRow}>
              <span style={styles.currency}>₹</span>
              <span style={styles.amount}>1,999</span>
              <span style={styles.term}>/ month</span>
            </div>
            <ul style={styles.featureList}>
              <li>✓ <strong>Full 30 Days unlimited access</strong></li>
              <li>✓ Unlimited mock interviews & live prep</li>
              <li>✓ Resume & Job Description matching</li>
              <li>✓ Priority low-latency streaming AI</li>
            </ul>
          </div>
        </div>

        {/* Payment QR Section */}
        {loading ? (
          <div style={styles.loadingBox}>Generating secure UPI QR...</div>
        ) : order ? (
          <div style={styles.paymentBox}>
            <div style={styles.qrCol}>
              <div style={styles.qrWrapper}>
                <img
                  src={customQrUrl || makeQrSvg(order.upi_uri, 190)}
                  alt="UPI QR Code"
                  style={styles.qrImage}
                />
              </div>
              <div style={styles.supportedApps}>
                Scan with GPay, PhonePe, Paytm, BHIM, CRED
              </div>
              {allowQrUpload && (
                <div style={{ marginTop: 10, textAlign: "center" }}>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={handleQrFileUpload}
                  />
                  <button
                    type="button"
                    style={styles.uploadQrBtn}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingQr}
                  >
                    {uploadingQr ? "Uploading..." : "📷 Upload Merchant QR"}
                  </button>
                  {customQrUrl && (
                    <div style={{ fontSize: 11, color: "#86efac", marginTop: 4 }}>
                      ✓ Custom Merchant QR Active
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={styles.instructionsCol}>
              <div style={styles.amountNotice}>
                Pay exactly: <strong style={{ color: "#38bdf8", fontSize: 18 }}>₹{order.amount}</strong>
              </div>

              <div style={styles.upiRow}>
                <span>UPI ID: <strong>{order.upi_vpa}</strong></span>
                <button type="button" onClick={copyUpiUri} style={styles.copyBtn}>
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>

              <form onSubmit={handleVerify} style={styles.verifyForm}>
                <label style={styles.inputLabel}>
                  Enter 12-digit UPI UTR / Transaction Ref:
                  <input
                    type="text"
                    required
                    placeholder="e.g. 4289XXXXXXXX"
                    value={utrRef}
                    onChange={(e) => setUtrRef(e.target.value)}
                    style={styles.utrInput}
                  />
                </label>
                <button
                  type="submit"
                  disabled={verifying || !utrRef.trim()}
                  style={styles.verifyBtn}
                >
                  {verifying ? "Verifying..." : "Confirm & Activate Access"}
                </button>
              </form>

              {successMessage && <div style={styles.successText}>{successMessage}</div>}
              {error && <div style={styles.errorText}>{error}</div>}
            </div>
          </div>
        ) : null}

        <div style={styles.footerRow}>
          {onClose && (
            <button style={styles.closeBtn} onClick={onClose}>
              Back
            </button>
          )}
          <span style={styles.secureBadge}>🔒 256-Bit Encrypted UPI Direct Transfer</span>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(5, 7, 13, 0.88)",
    backdropFilter: "blur(14px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    padding: 16,
    boxSizing: "border-box",
  },
  card: {
    background: "linear-gradient(150deg, #10131d 0%, #0c0e16 100%)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    boxShadow: "0 30px 70px rgba(0, 0, 0, 0.8), 0 0 50px rgba(99, 102, 241, 0.2)",
    borderRadius: 20,
    width: "100%",
    maxWidth: 780,
    maxHeight: "92vh",
    overflowY: "auto",
    padding: 28,
    boxSizing: "border-box",
    color: "#f8fafc",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  header: { textAlign: "center", marginBottom: 20 },
  badge: {
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1.2,
    background: "rgba(34, 197, 94, 0.18)",
    color: "#4ade80",
    border: "1px solid rgba(34, 197, 94, 0.3)",
    marginBottom: 8,
  },
  title: { margin: "0 0 6px", fontSize: 28, fontWeight: 700, letterSpacing: -0.5 },
  subtitle: { margin: "0 auto", fontSize: 13.5, color: "#94a3b8", maxWidth: 540, lineHeight: 1.5 },
  activeBanner: {
    background: "rgba(34, 197, 94, 0.15)",
    border: "1px solid rgba(34, 197, 94, 0.35)",
    color: "#86efac",
    padding: "10px 14px",
    borderRadius: 10,
    fontSize: 13,
    marginBottom: 16,
    textAlign: "center",
  },
  plansGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 16,
    marginBottom: 20,
  },
  planCard: {
    background: "rgba(255, 255, 255, 0.03)",
    border: "1px solid rgba(255, 255, 255, 0.09)",
    borderRadius: 14,
    padding: 18,
    cursor: "pointer",
    transition: "all 0.2s ease",
    display: "flex",
    flexDirection: "column",
  },
  planCardSelected: {
    background: "rgba(99, 102, 241, 0.12)",
    borderColor: "rgba(129, 140, 248, 0.6)",
    boxShadow: "0 0 25px rgba(99, 102, 241, 0.25)",
  },
  planBadge: {
    alignSelf: "flex-start",
    fontSize: 10,
    fontWeight: 700,
    color: "#818cf8",
    background: "rgba(99, 102, 241, 0.2)",
    padding: "3px 8px",
    borderRadius: 6,
    marginBottom: 8,
  },
  planName: { margin: "0 0 8px", fontSize: 18, fontWeight: 600 },
  priceRow: { display: "flex", alignItems: "baseline", gap: 3, marginBottom: 12 },
  currency: { fontSize: 20, color: "#cbd5e1" },
  amount: { fontSize: 32, fontWeight: 800, color: "#ffffff" },
  term: { fontSize: 13, color: "#94a3b8" },
  featureList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    fontSize: 12.5,
    color: "#cbd5e1",
    lineHeight: 1.6,
  },
  paymentBox: {
    background: "rgba(15, 20, 31, 0.7)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: 14,
    padding: 18,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 18,
    alignItems: "center",
    marginBottom: 16,
  },
  qrCol: { textAlign: "center" },
  qrWrapper: {
    background: "#ffffff",
    padding: 8,
    borderRadius: 12,
    display: "inline-block",
    boxShadow: "0 4px 15px rgba(0, 0, 0, 0.4)",
  },
  qrImage: { width: 170, height: 170, display: "block" },
  supportedApps: { fontSize: 11, color: "#94a3b8", marginTop: 8 },
  instructionsCol: { display: "flex", flexDirection: "column", gap: 10 },
  amountNotice: { fontSize: 14, color: "#e2e8f0" },
  upiRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "rgba(255, 255, 255, 0.05)",
    padding: "8px 12px",
    borderRadius: 8,
    fontSize: 12,
  },
  copyBtn: {
    padding: "4px 8px",
    background: "#4f46e5",
    border: 0,
    borderRadius: 6,
    color: "#fff",
    fontSize: 11,
    cursor: "pointer",
  },
  verifyForm: { display: "flex", flexDirection: "column", gap: 8 },
  inputLabel: { fontSize: 12, color: "#cbd5e1", display: "flex", flexDirection: "column", gap: 4 },
  utrInput: {
    background: "rgba(255, 255, 255, 0.08)",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    borderRadius: 8,
    padding: "9px 12px",
    color: "#ffffff",
    fontSize: 14,
    letterSpacing: 0.5,
  },
  verifyBtn: {
    background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
    border: "1px solid rgba(52, 211, 153, 0.4)",
    borderRadius: 8,
    color: "#ffffff",
    padding: "11px",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
    boxShadow: "0 4px 15px rgba(16, 185, 129, 0.3)",
  },
  loadingBox: { padding: 30, textAlign: "center", color: "#94a3b8" },
  successText: { color: "#4ade80", fontSize: 13, fontWeight: 600 },
  errorText: { color: "#f87171", fontSize: 13 },
  footerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  closeBtn: {
    background: "none",
    border: "1px solid rgba(255, 255, 255, 0.15)",
    color: "#cbd5e1",
    padding: "7px 16px",
    borderRadius: 8,
    cursor: "pointer",
  },
  uploadQrBtn: {
    background: "rgba(255, 255, 255, 0.08)",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    color: "#e2e8f0",
    padding: "4px 10px",
    borderRadius: 6,
    fontSize: 11,
    cursor: "pointer",
  },
  secureBadge: { fontSize: 11.5, color: "#64748b" },
};
