import { useState } from "react";
import DesktopDownload from "./DesktopDownload";
import CaptureProtectionSettings from "./CaptureProtectionSettings";
import AdminPlans from "./AdminPlans";
import ResumeUploadButton from "./ResumeUploadButton";
import { splitBold } from "./rich-text.mjs";
import { MIN_HUD_OPACITY } from "./hud-opacity.mjs";

export default function UserProfileModal({
  user,
  isAdmin,
  subscription,
  tokenUsage,
  profileLoading,
  profileError,
  onClose,
  onOpenPricing,
  onSignOut,
  storeUrl,
  localNetwork,
  desktop,
  resume,
  setResume,
  jd,
  setJd,
  opacity,
  setOpacity,
  onTop,
  setOnTop,
  captureProtection,
  capturePending,
  captureError,
  requestCaptureProtection,
}) {
  const [activeTab, setActiveTab] = useState("subscription"); // 'subscription' | 'profile' | 'settings' | 'download'

  const hasActiveSub = subscription && subscription.status === "active";
  const timeLeftMinutes = subscription?.time_remaining_seconds
    ? Math.ceil(subscription.time_remaining_seconds / 60) : null;
  const callMinutesLeft = subscription?.call_time_remaining_seconds
    ? Math.ceil(subscription.call_time_remaining_seconds / 60) : 0;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Modal Header */}
        <div style={styles.header}>
          <div style={styles.userBanner}>
            <div style={styles.avatar}>
              {(user || "U").slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div style={styles.userNameRow}>
                <h3 style={styles.username}>{user || "Candidate"}</h3>
                <span style={hasActiveSub ? styles.proBadge : styles.inactiveBadge}>
                  {hasActiveSub ? (subscription?.plan_name || "PRO ACTIVE") : "UNSUBSCRIBED"}
                </span>
              </div>
              <p style={styles.userSubtext}>TechPrep Stealth Intelligence Member</p>
            </div>
          </div>
          <button style={styles.closeBtn} onClick={onClose} title="Close Profile">✕</button>
        </div>

        {/* Tab Navigation */}
        <div style={styles.tabsRow}>
          <button
            style={{ ...styles.tab, ...(activeTab === "subscription" ? styles.tabActive : {}) }}
            onClick={() => setActiveTab("subscription")}
          >
            💳 Plan &amp; Usage
          </button>
          <button
            style={{ ...styles.tab, ...(activeTab === "profile" ? styles.tabActive : {}) }}
            onClick={() => setActiveTab("profile")}
          >
            📄 Resume &amp; JD
          </button>
          <button
            style={{ ...styles.tab, ...(activeTab === "settings" ? styles.tabActive : {}) }}
            onClick={() => setActiveTab("settings")}
          >
            ⚙️ Stealth &amp; HUD
          </button>
          <button
            style={{ ...styles.tab, ...(activeTab === "download" ? styles.tabActive : {}) }}
            onClick={() => setActiveTab("download")}
          >
            🖥️ Desktop App
          </button>
        </div>

        {/* Tab Body */}
        <div style={styles.body}>
          {activeTab === "subscription" && (
            <div style={styles.tabContent}>
              <div style={styles.cardSection}>
                <h4 style={styles.sectionTitle}>Current Subscription Status</h4>
                {hasActiveSub ? (
                  <div style={styles.activePlanCard}>
                    <div style={styles.planHeader}>
                      <div>
                        <div style={styles.planName}>{subscription.plan_name}</div>
                        <div style={styles.planMeta}>
                          Amount: <strong>₹{subscription.amount}</strong> · Status: <span style={{ color: "#4ade80" }}>Active</span>
                        </div>
                      </div>
                      <button style={styles.renewBtn} onClick={onOpenPricing}>
                        Upgrade / Extend
                      </button>
                    </div>

                    <div style={styles.usageBox}>
                      <div style={styles.usageItem}>
                        <span style={styles.usageLabel}>Plan Validity</span>
                        <strong style={styles.usageVal}>
                          {subscription.plan_id === "monthly"
                            ? `${Math.ceil(subscription.time_remaining_seconds / 86400)} days remaining`
                            : timeLeftMinutes !== null ? `${timeLeftMinutes} mins remaining` : "Starts on first use"}
                        </strong>
                      </div>
                      <div style={styles.usageItem}>
                        <span style={styles.usageLabel}>Call windows</span>
                        <strong style={styles.usageVal}>
                          {subscription.calls_total === null ? "Unlimited (existing plan)"
                            : subscription.calls_remaining === 0 && callMinutesLeft
                              ? "In progress (current session)"
                              : subscription.calls_remaining === 0
                                ? "Used — renew to continue"
                                : `${subscription.calls_remaining} of ${subscription.calls_total} remaining`}
                        </strong>
                        <span style={styles.usageLabel}>
                          {callMinutesLeft ? `${callMinutesLeft} mins left in current call`
                            : subscription.calls_remaining === null || subscription.calls_remaining
                              ? `A ${subscription.call_duration_minutes}-minute call starts on first AI or audio use`
                              : "All call-hours used; renew to continue"}
                        </span>
                      </div>
                      <div style={styles.usageItem}>
                        <span style={styles.usageLabel}>Capture Protection</span>
                        <strong style={styles.usageVal}>✓ Stealth Active (Win/Mac)</strong>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={styles.inactivePlanCard}>
                    <div style={{ color: "#fca5a5", fontSize: 14, marginBottom: 8, fontWeight: 600 }}>
                      ⚠️ No Active Subscription Found
                    </div>
                    <p style={{ color: "#94a3b8", fontSize: 13, margin: "0 0 16px", lineHeight: 1.5 }}>
                      Unlock real-time stealth AI answers and live audio transcription. Choose a call or monthly plan.
                    </p>
                    <button style={styles.subscribeBtn} onClick={onOpenPricing}>
                      View Plans →
                    </button>
                  </div>
                )}
              </div>
              {isAdmin && <AdminPlans />}
              <div style={styles.cardSection}>
                <h4 style={styles.sectionTitle}>AI Token Usage</h4>
                {profileError ? <p style={styles.hintText} role="alert">{profileError}</p>
                  : profileLoading || !tokenUsage ? <p style={styles.hintText}>Loading usage…</p>
                    : <>
                      <div style={styles.usageBox}>
                        <div style={styles.usageItem}>
                          <span style={styles.usageLabel}>Tokens burned</span>
                          <strong style={styles.usageVal}>{tokenUsage.total_tokens.toLocaleString()}</strong>
                        </div>
                        <div style={styles.usageItem}>
                          <span style={styles.usageLabel}>Input / Output</span>
                          <strong style={styles.usageVal}>
                            {tokenUsage.prompt_tokens.toLocaleString()} / {tokenUsage.completion_tokens.toLocaleString()}
                          </strong>
                        </div>
                        <div style={styles.usageItem}>
                          <span style={styles.usageLabel}>Tokens remaining</span>
                          <strong style={styles.usageVal}>No token cap — limited by call-hours</strong>
                        </div>
                      </div>
                      <p style={{ ...styles.hintText, margin: "10px 0 0" }}>
                        Recorded AI tokens since tracking began. Audio transcription is not token-billed; providers must return token usage for it to appear here.
                      </p>
                    </>}
              </div>
            </div>
          )}

          {activeTab === "profile" && (
            <div style={styles.tabContent}>
              <div style={styles.cardSection}>
                <h4 style={styles.sectionTitle}>Candidate Background Context</h4>
                <p style={styles.hintText}>
                  AI assistant matches questions to your actual past experience and the position requirements. Saved locally.
                </p>

                <label style={styles.fieldLabel}>
                  Resume (Experience, Skills, Projects)
                  <textarea
                    rows={6}
                    style={styles.textarea}
                    placeholder="Paste your resume contents or key accomplishments..."
                    value={resume}
                    onChange={(e) => setResume(e.target.value)}
                  />
                </label>
                <ResumeUploadButton onExtracted={setResume} style={{ marginTop: -4 }} />

                <label style={{ ...styles.fieldLabel, marginTop: 12 }}>
                  Target Job Description &amp; Requirements
                  <textarea
                    rows={4}
                    style={styles.textarea}
                    placeholder="Paste the job description, tech stack, or interviewer focus areas..."
                    value={jd}
                    onChange={(e) => setJd(e.target.value)}
                  />
                </label>
              </div>
            </div>
          )}

          {activeTab === "settings" && (
            <div style={styles.tabContent}>
              <div style={styles.cardSection}>
                <h4 style={styles.sectionTitle}>HUD Visibility &amp; OS Stealth</h4>
                <label style={styles.settingRow}>
                  <span>👁️ HUD Background Opacity</span>
                  <input
                    type="range"
                    min={MIN_HUD_OPACITY}
                    max="1"
                    step="0.05"
                    value={opacity}
                    onChange={(e) => setOpacity(e.target.value)}
                    style={{ width: 140 }}
                  />
                </label>

                {desktop && (
                  <label style={styles.settingRow}>
                    <span>📌 Always Keep On Top of Meeting</span>
                    <input
                      type="checkbox"
                      checked={onTop}
                      onChange={(e) => setOnTop(e.target.checked)}
                    />
                  </label>
                )}

                {desktop && (
                  <div style={{ marginTop: 16 }}>
                    <CaptureProtectionSettings
                      state={captureProtection}
                      pending={capturePending}
                      error={captureError}
                      onRequest={requestCaptureProtection}
                      cardStyle={{ background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.08)", padding: 12, borderRadius: 10 }}
                      rowStyle={{ display: "flex", alignItems: "center", gap: 10 }}
                      buttonStyle={{}}
                    />
                  </div>
                )}

                <div style={{ marginTop: 16 }}>
                  <a href="/privacy/" target="_blank" rel="noopener noreferrer" style={styles.privacyLink}>
                    View Privacy Policy &amp; Security Guarantees
                  </a>
                </div>
              </div>
            </div>
          )}

          {activeTab === "download" && (
            <div style={styles.tabContent}>
              <DesktopDownload localNetwork={localNetwork} storeUrl={storeUrl} />
            </div>
          )}
        </div>

        {/* Modal Footer with Sign Out */}
        <div style={styles.footer}>
          <div style={styles.footerInfo}>
            Signed in as <strong>{user}</strong>
          </div>
          <button style={styles.signOutBtn} onClick={onSignOut}>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(4, 6, 12, 0.85)",
    backdropFilter: "blur(12px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9998,
    padding: 16,
    boxSizing: "border-box",
  },
  modal: {
    background: "linear-gradient(150deg, #10131d 0%, #0c0e16 100%)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    boxShadow: "0 30px 80px rgba(0, 0, 0, 0.85), 0 0 50px rgba(99, 102, 241, 0.2)",
    borderRadius: 20,
    width: "100%",
    maxWidth: 680,
    maxHeight: "92vh",
    display: "flex",
    flexDirection: "column",
    color: "#f8fafc",
    fontFamily: "system-ui, -apple-system, sans-serif",
    overflow: "hidden",
  },
  header: {
    padding: "20px 24px",
    borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  userBanner: { display: "flex", alignItems: "center", gap: 14 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 16,
    fontWeight: 700,
    color: "#fff",
    boxShadow: "0 4px 15px rgba(99, 102, 241, 0.4)",
  },
  userNameRow: { display: "flex", alignItems: "center", gap: 8 },
  username: { margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: -0.3 },
  proBadge: {
    background: "rgba(34, 197, 94, 0.2)",
    border: "1px solid rgba(34, 197, 94, 0.4)",
    color: "#4ade80",
    fontSize: 10,
    fontWeight: 700,
    padding: "2px 8px",
    borderRadius: 999,
  },
  inactiveBadge: {
    background: "rgba(239, 68, 68, 0.2)",
    border: "1px solid rgba(239, 68, 68, 0.4)",
    color: "#f87171",
    fontSize: 10,
    fontWeight: 700,
    padding: "2px 8px",
    borderRadius: 999,
  },
  userSubtext: { margin: "2px 0 0", fontSize: 12, color: "#94a3b8" },
  closeBtn: {
    background: "rgba(255, 255, 255, 0.06)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: "50%",
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#94a3b8",
    cursor: "pointer",
    fontSize: 14,
  },
  tabsRow: {
    display: "flex",
    borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
    padding: "0 16px",
    background: "rgba(0, 0, 0, 0.2)",
    overflowX: "auto",
  },
  tab: {
    padding: "12px 16px",
    background: "none",
    border: "none",
    borderBottom: "2px solid transparent",
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s ease",
    whiteSpace: "nowrap",
  },
  tabActive: {
    color: "#ffffff",
    borderBottomColor: "#6366f1",
  },
  body: {
    padding: 24,
    overflowY: "auto",
    flex: 1,
  },
  tabContent: { display: "flex", flexDirection: "column", gap: 16 },
  cardSection: {
    background: "rgba(255, 255, 255, 0.02)",
    border: "1px solid rgba(255, 255, 255, 0.06)",
    borderRadius: 14,
    padding: 18,
  },
  sectionTitle: { margin: "0 0 10px", fontSize: 15, fontWeight: 600, color: "#e2e8f0" },
  hintText: { margin: "0 0 14px", fontSize: 12.5, color: "#94a3b8", lineHeight: 1.4 },
  activePlanCard: {
    background: "linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(124, 58, 237, 0.06) 100%)",
    border: "1px solid rgba(129, 140, 248, 0.3)",
    borderRadius: 12,
    padding: 16,
  },
  planHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
    flexWrap: "wrap",
    gap: 10,
  },
  planName: { fontSize: 18, fontWeight: 700, color: "#ffffff" },
  planMeta: { fontSize: 12.5, color: "#94a3b8", marginTop: 2 },
  renewBtn: {
    background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
    border: 0,
    color: "#fff",
    padding: "8px 14px",
    borderRadius: 8,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(99, 102, 241, 0.3)",
  },
  usageBox: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 10,
    background: "rgba(0, 0, 0, 0.3)",
    padding: 12,
    borderRadius: 10,
  },
  usageItem: { display: "flex", flexDirection: "column", gap: 3 },
  usageLabel: { fontSize: 11, color: "#94a3b8" },
  usageVal: { fontSize: 12.5, color: "#f8fafc" },
  inactivePlanCard: {
    background: "rgba(239, 68, 68, 0.06)",
    border: "1px solid rgba(239, 68, 68, 0.2)",
    borderRadius: 12,
    padding: 16,
  },
  subscribeBtn: {
    background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
    border: "1px solid rgba(52, 211, 153, 0.4)",
    color: "#fff",
    padding: "10px 18px",
    borderRadius: 8,
    fontSize: 13.5,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 4px 15px rgba(16, 185, 129, 0.3)",
  },
  fieldLabel: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 13,
    color: "#cbd5e1",
    fontWeight: 500,
  },
  textarea: {
    background: "rgba(255, 255, 255, 0.05)",
    border: "1px solid rgba(255, 255, 255, 0.15)",
    borderRadius: 8,
    padding: 10,
    color: "#ffffff",
    fontFamily: "inherit",
    fontSize: 13,
    boxSizing: "border-box",
  },
  settingRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 0",
    borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
    fontSize: 13.5,
  },
  privacyLink: { color: "#818cf8", fontSize: 13, textDecoration: "none" },
  footer: {
    padding: "16px 24px",
    borderTop: "1px solid rgba(255, 255, 255, 0.08)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: "rgba(0, 0, 0, 0.2)",
  },
  footerInfo: { fontSize: 12.5, color: "#94a3b8" },
  signOutBtn: {
    background: "rgba(239, 68, 68, 0.15)",
    border: "1px solid rgba(239, 68, 68, 0.3)",
    color: "#f87171",
    padding: "8px 16px",
    borderRadius: 8,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  },
};
