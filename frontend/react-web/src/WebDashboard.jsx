import { useState } from "react";
import DesktopDownload from "./DesktopDownload";
import SubscriptionPricing from "./SubscriptionPricing";

export default function WebDashboard({
  user,
  subscription,
  onSignOut,
  storeUrl,
  localNetwork,
  onRefreshSubscription,
}) {
  const [showPricing, setShowPricing] = useState(false);
  const hasActiveSub = subscription && subscription.status === "active";
  const timeLeftMinutes = subscription?.time_remaining_seconds
    ? Math.ceil(subscription.time_remaining_seconds / 60)
    : null;

  return (
    <div style={styles.container}>
      {/* Top Navbar */}
      <header style={styles.navbar}>
        <div style={styles.navBrand}>
          <div style={styles.logoBadge}>TP</div>
          <div>
            <h1 style={styles.brandTitle}>TechPrep</h1>
            <span style={styles.brandSubtitle}>Stealth Interview Copilot</span>
          </div>
        </div>
        <div style={styles.navUser}>
          <div style={styles.userPill}>
            <span style={{ ...styles.statusDot, background: hasActiveSub ? "#4ade80" : "#f87171" }} />
            <span style={styles.userName}>{user}</span>
            <span style={hasActiveSub ? styles.proTag : styles.unpaidTag}>
              {hasActiveSub ? (subscription.plan_name.split(" ")[0]) : "Inactive"}
            </span>
          </div>
          <button style={styles.signOutBtn} onClick={onSignOut}>
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={styles.main}>
        {/* Important Notice */}
        <div style={styles.securityAlert}>
          <div style={styles.alertIcon}>🛡️</div>
          <div>
            <h3 style={styles.alertTitle}>Desktop Application Required For Live Calls</h3>
            <p style={styles.alertText}>
              Web browsers <strong>cannot hide from screen sharing</strong> (Zoom, Google Meet, Microsoft Teams).
              To ensure interviewers never detect your copilot window, all live listening, AI transcription, and answer assists operate exclusively within the <strong>TechPrep Desktop App</strong> with hardware-level screen share protection.
            </p>
          </div>
        </div>

        <div style={styles.grid}>
          {/* Subscription Card */}
          <section style={styles.card}>
            <div style={styles.cardHeader}>
              <h2 style={styles.cardTitle}>💳 Subscription &amp; Credits</h2>
              <span style={hasActiveSub ? styles.activeBadge : styles.inactiveBadge}>
                {hasActiveSub ? "Active" : "Action Required"}
              </span>
            </div>

            {hasActiveSub ? (
              <div style={styles.subActiveContent}>
                <div style={styles.subPlanRow}>
                  <div>
                    <div style={styles.subPlanName}>{subscription.plan_name}</div>
                    <div style={styles.subPlanMeta}>Amount: ₹{subscription.amount}</div>
                  </div>
                  <button style={styles.actionBtn} onClick={() => setShowPricing(true)}>
                    Upgrade / Renew
                  </button>
                </div>

                <div style={styles.detailBox}>
                  <div style={styles.detailItem}>
                    <span style={styles.detailLabel}>Session Validity</span>
                    <strong style={styles.detailValue}>
                      {timeLeftMinutes !== null ? `${timeLeftMinutes} mins remaining` : "1-Hour Call Window"}
                    </strong>
                  </div>
                  <div style={styles.detailItem}>
                    <span style={styles.detailLabel}>Real-Time LLM Answers</span>
                    <strong style={{ ...styles.detailValue, color: "#4ade80" }}>✓ Unlocked</strong>
                  </div>
                  <div style={styles.detailItem}>
                    <span style={styles.detailLabel}>OS Screen Shielding</span>
                    <strong style={{ ...styles.detailValue, color: "#4ade80" }}>✓ Windows &amp; Mac Enabled</strong>
                  </div>
                </div>
              </div>
            ) : (
              <div style={styles.subInactiveContent}>
                <p style={styles.inactiveText}>
                  You do not have an active session plan. Select ₹199 per call or ₹1,999 monthly unlimited to start.
                </p>
                <button style={styles.primaryBtn} onClick={() => setShowPricing(true)}>
                  Unlock TechPrep Pro Now (from ₹199) →
                </button>
              </div>
            )}
          </section>

          {/* Desktop App Download Card */}
          <section style={styles.card}>
            <div style={styles.cardHeader}>
              <h2 style={styles.cardTitle}>🖥️ Install TechPrep Desktop App</h2>
            </div>
            <p style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.6, margin: "0 0 16px" }}>
              Install the stealth client once on your machine. Future app updates occur automatically.
            </p>
            <DesktopDownload localNetwork={localNetwork} storeUrl={storeUrl} />
            <div style={styles.instructionList}>
              <div style={styles.instructionStep}>
                <span style={styles.stepNum}>1</span>
                <span>Install from Microsoft Store or local bundle above.</span>
              </div>
              <div style={styles.instructionStep}>
                <span style={styles.stepNum}>2</span>
                <span>Open TechPrep on Windows/macOS and sign in with this account.</span>
              </div>
              <div style={styles.instructionStep}>
                <span style={styles.stepNum}>3</span>
                <span>The floating transparent HUD stays always-on-top and 100% invisible to interview screen sharing.</span>
              </div>
            </div>
          </section>
        </div>
      </main>

      {showPricing && (
        <SubscriptionPricing
          currentSubscription={subscription}
          onClose={() => setShowPricing(false)}
          onPaymentSuccess={() => {
            setShowPricing(false);
            if (onRefreshSubscription) onRefreshSubscription();
          }}
        />
      )}
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    background: "#080a11",
    color: "#f8fafc",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  navbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 28px",
    background: "rgba(16, 19, 29, 0.8)",
    borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
    backdropFilter: "blur(12px)",
  },
  navBrand: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  logoBadge: {
    width: 38,
    height: 38,
    borderRadius: 10,
    background: "linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    fontSize: 16,
    color: "#080a11",
    boxShadow: "0 0 16px rgba(56, 189, 248, 0.3)",
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: 700,
    margin: 0,
    letterSpacing: "-0.02em",
  },
  brandSubtitle: {
    fontSize: 11,
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  navUser: {
    display: "flex",
    alignItems: "center",
    gap: 14,
  },
  userPill: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "rgba(255, 255, 255, 0.05)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    padding: "6px 14px",
    borderRadius: 9999,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 9999,
  },
  userName: {
    fontSize: 13,
    fontWeight: 600,
  },
  proTag: {
    fontSize: 10,
    padding: "2px 6px",
    borderRadius: 4,
    background: "rgba(74, 222, 128, 0.15)",
    color: "#86efac",
    fontWeight: 700,
  },
  unpaidTag: {
    fontSize: 10,
    padding: "2px 6px",
    borderRadius: 4,
    background: "rgba(248, 113, 113, 0.15)",
    color: "#fca5a5",
    fontWeight: 700,
  },
  signOutBtn: {
    background: "rgba(255, 255, 255, 0.06)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    color: "#cbd5e1",
    padding: "7px 14px",
    borderRadius: 8,
    fontSize: 12,
    cursor: "pointer",
    fontWeight: 600,
  },
  main: {
    maxWidth: 1040,
    margin: "0 auto",
    padding: "36px 20px",
  },
  securityAlert: {
    display: "flex",
    gap: 16,
    background: "rgba(245, 158, 11, 0.08)",
    border: "1px solid rgba(245, 158, 11, 0.3)",
    borderRadius: 14,
    padding: "18px 22px",
    marginBottom: 28,
  },
  alertIcon: {
    fontSize: 28,
    lineHeight: 1,
  },
  alertTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: "#fbbf24",
    margin: "0 0 6px",
  },
  alertText: {
    fontSize: 13,
    color: "#cbd5e1",
    lineHeight: 1.5,
    margin: 0,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 24,
  },
  card: {
    background: "rgba(16, 19, 29, 0.8)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: 16,
    padding: 24,
    backdropFilter: "blur(12px)",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: 700,
    margin: 0,
  },
  activeBadge: {
    background: "rgba(74, 222, 128, 0.15)",
    color: "#86efac",
    border: "1px solid rgba(74, 222, 128, 0.3)",
    fontSize: 11,
    padding: "3px 8px",
    borderRadius: 9999,
    fontWeight: 700,
  },
  inactiveBadge: {
    background: "rgba(248, 113, 113, 0.15)",
    color: "#fca5a5",
    border: "1px solid rgba(248, 113, 113, 0.3)",
    fontSize: 11,
    padding: "3px 8px",
    borderRadius: 9999,
    fontWeight: 700,
  },
  subActiveContent: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  subPlanRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 16px",
    borderRadius: 12,
    background: "rgba(255, 255, 255, 0.03)",
    border: "1px solid rgba(255, 255, 255, 0.06)",
  },
  subPlanName: {
    fontSize: 16,
    fontWeight: 700,
    color: "#38bdf8",
  },
  subPlanMeta: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 2,
  },
  actionBtn: {
    background: "rgba(56, 189, 248, 0.15)",
    border: "1px solid rgba(56, 189, 248, 0.3)",
    color: "#38bdf8",
    padding: "8px 14px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  detailBox: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    background: "rgba(0, 0, 0, 0.2)",
    padding: 14,
    borderRadius: 10,
  },
  detailItem: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 13,
  },
  detailLabel: {
    color: "#94a3b8",
  },
  detailValue: {
    fontWeight: 600,
  },
  subInactiveContent: {
    textAlign: "center",
    padding: "16px 0",
  },
  inactiveText: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 1.5,
    margin: "0 0 16px",
  },
  primaryBtn: {
    width: "100%",
    background: "linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)",
    color: "#080a11",
    border: "none",
    padding: "12px 18px",
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 6px 20px rgba(56, 189, 248, 0.35)",
  },
  instructionList: {
    marginTop: 20,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    borderTop: "1px solid rgba(255, 255, 255, 0.08)",
    paddingTop: 16,
  },
  instructionStep: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    fontSize: 12,
    color: "#94a3b8",
    lineHeight: 1.4,
  },
  stepNum: {
    width: 18,
    height: 18,
    borderRadius: 9999,
    background: "rgba(255, 255, 255, 0.1)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 10,
    fontWeight: 700,
    color: "#f8fafc",
    flexShrink: 0,
    marginTop: 1,
  },
};
