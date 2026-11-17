import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import Icon from "./Icon";
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
    <Dialog label="Choose your interview plan" onClose={onClose} className="tp-pricing">
        <div className="tp-dialog-heading">
          <div><span className="tp-eyebrow">INVEST IN YOUR NEXT CHAPTER</span>
            <h2>Make room for what’s next.</h2>
            <p>Choose the interview plan that fits your pace.</p>
          </div>
          {onClose && <button className="tp-btn" onClick={onClose} aria-label="Close pricing"><Icon name="close" size={18} /></button>}
        </div>
        {error && <div style={styles.errorText} role="alert">{error}</div>}

        {currentSubscription?.status === "active" && (
          <div className="tp-pricing-notice">
            ✓ You have an active subscription: <strong>{currentSubscription.plan_name}</strong>
            {currentSubscription.time_remaining_seconds && (
              <span> ({currentSubscription.plan_id === "monthly"
                ? `${Math.ceil(currentSubscription.time_remaining_seconds / 86400)} days`
                : `${Math.ceil(currentSubscription.time_remaining_seconds / 60)} mins`} remaining)</span>
            )}
          </div>
        )}

        {/* Plan Cards */}
        <div className="tp-plan-choices" role="radiogroup" aria-label="Interview plan">
          {/* Hourly Card */}
          {hourly && <label className={`tp-plan-choice ${selectedPlan === "hourly_call" ? "selected" : ""}`}>
            <input type="radio" name="interview-plan" value="hourly_call" checked={selectedPlan === "hourly_call"}
              onChange={() => handleSelectPlan("hourly_call")} disabled={verifying || Boolean(pendingPayment)} aria-label={hourly.name} />
            <span className="tp-eyebrow" style={{ fontSize: 10 }}>ONE FOCUSED SESSION</span>
            <h3>{hourly.name}</h3>
            <div className="tp-price">
              ₹{hourly.amount.toLocaleString("en-IN")} <small>/ call</small>
            </div>
            <ul>
              <li>✓ <strong>{hourly.duration_minutes} minutes continuous assistance</strong></li>
              <li>✓ Reconnect protection (same call window)</li>
              <li>✓ Real-time loopback audio transcription</li>
              <li>✓ Stealth capture-protection HUD</li>
            </ul>
          </label>}

          {/* Monthly Card */}
          {monthly && <label className={`tp-plan-choice ${selectedPlan === "monthly" ? "selected" : ""}`}>
            <input type="radio" name="interview-plan" value="monthly" checked={selectedPlan === "monthly"}
              onChange={() => handleSelectPlan("monthly")} disabled={verifying || Boolean(pendingPayment)} aria-label={monthly.name} />
            <span className="tp-eyebrow" style={{ fontSize: 10 }}>BUILD YOUR MOMENTUM</span>
            <h3>{monthly.name}</h3>
            <div className="tp-price">
              ₹{monthly.amount.toLocaleString("en-IN")} <small>/ month</small>
            </div>
            <ul>
              <li>✓ <strong>{monthly.call_limit} one-hour calls within {monthly.duration_days} days</strong></li>
              <li>✓ Mock interviews & live prep during each call</li>
              <li>✓ Resume & Job Description matching</li>
              <li>✓ Priority low-latency streaming AI</li>
            </ul>
          </label>}
        </div>

        {/* Payment Section */}
        {loading ? (
          <div style={styles.loadingBox}>Preparing payment...</div>
        ) : order ? (
          <div style={styles.paymentBox}>
            <div style={styles.instructionsCol}>
              <div style={styles.amountNotice}>
                Pay <strong>₹{order.amount}</strong> securely with Razorpay
                {order.processing_fee ? (
                  <> (₹{order.base_amount} plan + ₹{order.processing_fee} payment gateway fee)</>
                ) : null}.
              </div>
              <button type="button" onClick={handleCheckout} disabled={verifying} className="tp-btn tp-btn-primary" style={{ width: "100%" }}>
                {verifying ? "Verifying..." : pendingPayment ? "Retry verification" : "Pay & Activate Access"}
              </button>
              {successMessage && <div style={styles.successText}>{successMessage}</div>}
            </div>
          </div>
        ) : null}
        <p style={{ fontSize: 12, color: "#b3abc7", textAlign: "center" }}>ATS scoring is free. Full resume rebuilds and downloads are a separate ₹10 purchase with 24-hour access.</p>

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
          <span style={styles.secureBadge}><Icon name="shield" size={14} /> Secure checkout by Razorpay</span>
        </div>
    </Dialog>
  );
}

const styles = {
  paymentBox: {
    background: "rgba(15, 20, 31, 0.7)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: 14,
    padding: 18,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: 18,
    alignItems: "center",
    marginBottom: 16,
  },
  instructionsCol: { display: "flex", flexDirection: "column", gap: 10 },
  amountNotice: { fontSize: 14, color: "#e2e8f0" },
  loadingBox: { padding: 30, textAlign: "center", color: "#aaa4bc" },
  successText: { color: "#4ade80", fontSize: 13, fontWeight: 600 },
  errorText: { color: "#f87171", fontSize: 13 },
  footerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  closeBtn: {
    background: "none",
    border: "1px solid rgba(255, 255, 255, 0.15)",
    color: "#d3cedf",
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
  secureBadge: { fontSize: 11.5, color: "#9890ab" },
};
