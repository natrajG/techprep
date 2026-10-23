import { useEffect, useRef, useState } from "react";
import { createPaymentOrder, fetchPlans, uploadCustomQr, verifyPayment } from "./subscriptions.mjs";

const API = import.meta.env.VITE_API_URL || "";

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

export default function SubscriptionPricing({ currentSubscription, onPaymentSuccess, onClose, allowQrUpload = false }) {
  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState("hourly_call");
  const [order, setOrder] = useState(null);
  const [utrRef, setUtrRef] = useState("");
  const [pendingPayment, setPendingPayment] = useState(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [uploadingQr, setUploadingQr] = useState(false);
  const fileInputRef = useRef(null);
  const orderRequestRef = useRef(0);
  const hourly = plans.find((plan) => plan.id === "hourly_call");
  const monthly = plans.find((plan) => plan.id === "monthly");

  useEffect(() => {
    fetchPlans(API)
      .then((data) => {
        setPlans(data.plans || []);
        handleSelectPlan("hourly_call");
      })
      .catch((e) => setError("Failed to load plans: " + e.message));
  }, []);

  async function handleSelectPlan(planId) {
    const requestId = ++orderRequestRef.current;
    setSelectedPlan(planId);
    setLoading(true);
    setError("");
    setOrder(null);
    setPendingPayment(null);
    try {
      const orderData = await createPaymentOrder(API, planId);
      if (requestId === orderRequestRef.current) setOrder(orderData);
    } catch (e) {
      if (requestId === orderRequestRef.current) setError(e.message);
    } finally {
      if (requestId === orderRequestRef.current) setLoading(false);
    }
  }

  async function handleQrFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingQr(true);
    setError("");
    try {
      await uploadCustomQr(API, file);
    } catch (err) {
      setError("Failed to upload QR: " + err.message);
    } finally {
      setUploadingQr(false);
    }
  }

  async function handleVerify(e) {
    e.preventDefault();
    if (!order || !utrRef.trim()) return;
    await activate({ utr_ref: utrRef.trim() });
  }

  async function activate(details) {
    setVerifying(true);
    setError("");
    try {
      const res = await verifyPayment(API, order.order_id, details);
      setPendingPayment(null);
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

  async function handleCheckout() {
    if (!order || verifying) return;
    if (pendingPayment) {
      await activate(pendingPayment);
      return;
    }
    setVerifying(true);
    setError("");
    try {
      await loadRazorpay();
      const checkout = new window.Razorpay({
        key: order.razorpay_key_id,
        amount: order.amount * 100,
        currency: "INR",
        name: "TechPrep",
        order_id: order.razorpay_order_id,
        handler: (payment) => {
          const details = {
            razorpay_payment_id: payment.razorpay_payment_id,
            razorpay_signature: payment.razorpay_signature,
          };
          setPendingPayment(details);
          activate(details);
        },
      });
      checkout.on("payment.failed", (failure) => setError(failure.error?.description || "Payment failed"));
      checkout.open();
    } catch (e) {
      setError(e.message);
    } finally {
      setVerifying(false);
    }
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
        {error && <div style={styles.errorText} role="alert">{error}</div>}

        {currentSubscription?.status === "active" && (
          <div style={styles.activeBanner}>
            ✓ You have an active subscription: <strong>{currentSubscription.plan_name}</strong>
            {currentSubscription.time_remaining_seconds && (
              <span> ({currentSubscription.plan_id === "monthly"
                ? `${Math.ceil(currentSubscription.time_remaining_seconds / 86400)} days`
                : `${Math.ceil(currentSubscription.time_remaining_seconds / 60)} mins`} remaining)</span>
            )}
          </div>
        )}

        {/* Plan Cards */}
        <div style={styles.plansGrid}>
          {/* Hourly Card */}
          {hourly && <div
            onClick={() => handleSelectPlan("hourly_call")}
            style={{
              ...styles.planCard,
              ...(selectedPlan === "hourly_call" ? styles.planCardSelected : {}),
            }}
          >
            <div style={styles.planBadge}>POPULAR FOR INTERVIEWS</div>
            <h3 style={styles.planName}>{hourly.name}</h3>
            <div style={styles.priceRow}>
              <span style={styles.currency}>₹</span>
              <span style={styles.amount}>{hourly.amount.toLocaleString()}</span>
              <span style={styles.term}>/ call</span>
            </div>
            <ul style={styles.featureList}>
              <li>✓ <strong>{hourly.duration_minutes} minutes continuous assistance</strong></li>
              <li>✓ Reconnect protection (same call window)</li>
              <li>✓ Real-time loopback audio transcription</li>
              <li>✓ Stealth capture-protection HUD</li>
            </ul>
          </div>}

          {/* Monthly Card */}
          {monthly && <div
            onClick={() => handleSelectPlan("monthly")}
            style={{
              ...styles.planCard,
              ...(selectedPlan === "monthly" ? styles.planCardSelected : {}),
            }}
          >
            <div style={{ ...styles.planBadge, background: "rgba(234, 179, 8, 0.2)", color: "#facc15" }}>
              BEST VALUE FOR JOB SEARCH
            </div>
            <h3 style={styles.planName}>{monthly.name}</h3>
            <div style={styles.priceRow}>
              <span style={styles.currency}>₹</span>
              <span style={styles.amount}>{monthly.amount.toLocaleString()}</span>
              <span style={styles.term}>/ month</span>
            </div>
            <ul style={styles.featureList}>
              <li>✓ <strong>{monthly.call_limit} one-hour calls within {monthly.duration_days} days</strong></li>
              <li>✓ Mock interviews & live prep during each call</li>
              <li>✓ Resume & Job Description matching</li>
              <li>✓ Priority low-latency streaming AI</li>
            </ul>
          </div>}
        </div>

        {/* Payment Section */}
        {loading ? (
          <div style={styles.loadingBox}>Preparing payment...</div>
        ) : order ? (
          order.payment_mode === "razorpay" ? (
            <div style={styles.paymentBox}>
              <div style={styles.instructionsCol}>
                <div style={styles.amountNotice}>Pay <strong>₹{order.amount}</strong> securely with Razorpay.</div>
                <button type="button" onClick={handleCheckout} disabled={verifying} style={styles.verifyBtn}>
                  {verifying ? "Verifying..." : pendingPayment ? "Retry verification" : "Pay & Activate Access"}
                </button>
                {successMessage && <div style={styles.successText}>{successMessage}</div>}
              </div>
            </div>
          ) : (
          <div style={styles.paymentBox}>
            <div style={styles.instructionsCol}>
              <div style={styles.amountNotice}>
                Test account: no payment required. Activate the <strong>₹{order.amount}</strong> plan with a 12-digit dummy UTR.
              </div>

              <form onSubmit={handleVerify} style={styles.verifyForm}>
                <label style={styles.inputLabel}>
                  Enter 12-digit UPI UTR / Transaction Ref:
                  <input
                    type="text"
                    required
                    inputMode="numeric"
                    pattern="[0-9]{12}"
                    maxLength={12}
                    placeholder="e.g. 428912345678"
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
            </div>
          </div>
          )
        ) : null}

        {allowQrUpload && (
          <div>
            <input type="file" ref={fileInputRef} accept="image/*" style={{ display: "none" }} onChange={handleQrFileUpload} />
            <button type="button" style={styles.uploadQrBtn} onClick={() => fileInputRef.current?.click()} disabled={uploadingQr}>
              {uploadingQr ? "Uploading..." : "Upload legacy merchant QR"}
            </button>
            <span style={styles.secureBadge}> Not used for Razorpay checkout or payment verification.</span>
          </div>
        )}

        <div style={styles.footerRow}>
          {onClose && (
            <button style={styles.closeBtn} onClick={onClose}>
              Back
            </button>
          )}
          <span style={styles.secureBadge}>{order?.payment_mode === "razorpay" ? "Secure checkout by Razorpay" : "Test payment"}</span>
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
