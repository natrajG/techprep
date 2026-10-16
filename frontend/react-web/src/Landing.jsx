import { useState } from "react";
import InteractiveDemo from "./InteractiveDemo";
import SubscriptionPricing from "./SubscriptionPricing";

export default function Landing({ onSignIn, onSignUp, storeUrl }) {
  const [showDemo, setShowDemo] = useState(false);
  const [showPricing, setShowPricing] = useState(false);

  return (
    <main style={styles.page}>
      <header style={styles.nav}>
        <div style={styles.brand}>
          <span style={styles.logoDot}></span>
          <span style={styles.brandText}>TechPrep</span>
          <span style={styles.badgePro}>AI PRO</span>
        </div>
        <div style={styles.navActions}>
          <button style={styles.navBtn} onClick={() => setShowDemo(true)}>
            Interactive Demo
          </button>
          <button style={styles.navBtn} onClick={() => setShowPricing(true)}>
            Pricing (₹199 / Call)
          </button>
          <button style={styles.navBtn} onClick={onSignIn}>
            Sign In
          </button>
          <button style={styles.navPrimary} onClick={onSignUp || onSignIn}>
            Sign Up
          </button>
        </div>
      </header>

      <section style={styles.hero}>
        <div style={styles.tagline}>
          <span>✨</span> NEXT-GEN STEALTH INTERVIEW INTELLIGENCE
        </div>
        <h1 style={styles.heroTitle}>
          Crack Every Tech Interview with <span style={styles.gradientText}>Invisible AI HUD</span>
        </h1>
        <p style={styles.lead}>
          Real-time audio transcription and instant, resume-tailored answers delivered through an undetectable,
          always-on-top glass overlay. Hidden from Zoom, Teams & Google Meet screen sharing.
        </p>

        <div style={styles.actions}>
          <button style={styles.primary} onClick={onSignUp || onSignIn}>
            Sign Up &amp; Start Trial →
          </button>
          <button style={styles.demoAction} onClick={() => setShowDemo(true)}>
            ▶ Watch Live Simulation
          </button>
        </div>

        <div style={styles.statsRow}>
          <div style={styles.statItem}>
            <strong>₹199</strong>
            <span>Per Call / 1-Hr Window</span>
          </div>
          <div style={styles.statDivider}></div>
          <div style={styles.statItem}>
            <strong>&lt; 800ms</strong>
            <span>Token Stream Latency</span>
          </div>
          <div style={styles.statDivider}></div>
          <div style={styles.statItem}>
            <strong>100%</strong>
            <span>Screen-Share Invisible (Win/Mac)</span>
          </div>
        </div>
      </section>

      <section style={styles.grid} aria-label="Features">
        <article style={styles.card}>
          <div style={styles.cardIcon}>🎙️</div>
          <h2 style={styles.h2}>Direct Loopback Audio</h2>
          <p style={styles.cardText}>
            Captures interviewer questions straight from your PC audio output with zero mic echo or background noise.
          </p>
        </article>
        <article style={styles.card}>
          <div style={styles.cardIcon}>⚡</div>
          <h2 style={styles.h2}>Tailored Suggested Answers</h2>
          <p style={styles.cardText}>
            Delivers concise, high-impact bullet points and working code snippets customized to your resume and the JD.
          </p>
        </article>
        <article style={styles.card}>
          <div style={styles.cardIcon}>🛡️</div>
          <h2 style={styles.h2}>Desktop Capture Protection</h2>
          <p style={styles.cardText}>
            Native OS-level content protection ensures the assistant is never recorded or shown in screen shares.
          </p>
        </article>
      </section>

      {/* Pricing Teaser Section */}
      <section style={styles.pricingTeaser}>
        <h2 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 8px", color: "#fff" }}>
          Unmatched Value for Job Seekers
        </h2>
        <p style={{ color: "#94a3b8", fontSize: 14, margin: "0 0 24px" }}>
          Why pay $100+ USD to US competitors when you can prepare with local UPI convenience?
        </p>
        <div style={styles.pricingCards}>
          <div
            style={{ ...styles.priceCardSmall, cursor: "pointer" }}
            onClick={() => setShowPricing(true)}
          >
            <span style={styles.priceCardBadge}>PAY AS YOU GO</span>
            <h3 style={{ margin: "6px 0", fontSize: 20 }}>1-Hour Call Session</h3>
            <p style={{ fontSize: 28, fontWeight: 800, color: "#38bdf8", margin: "4px 0 12px" }}>₹199</p>
            <p style={{ fontSize: 13, color: "#94a3b8", margin: "0 0 14px" }}>
              Perfect for crucial interview rounds. Reconnects within 60 mins stay covered.
            </p>
            <button style={{ ...styles.primary, padding: "8px 14px", fontSize: 13, width: "100%" }}>
              Get Started (₹199) →
            </button>
          </div>
          <div
            style={{ ...styles.priceCardSmall, borderColor: "rgba(165, 180, 252, 0.4)", cursor: "pointer" }}
            onClick={() => setShowPricing(true)}
          >
            <span style={{ ...styles.priceCardBadge, background: "rgba(234, 179, 8, 0.2)", color: "#fde047" }}>
              MOST POPULAR
            </span>
            <h3 style={{ margin: "6px 0", fontSize: 20 }}>Monthly Pro</h3>
            <p style={{ fontSize: 28, fontWeight: 800, color: "#a5b4fc", margin: "4px 0 12px" }}>₹1,999</p>
            <p style={{ fontSize: 13, color: "#94a3b8", margin: "0 0 14px" }}>
              Full 30 days unlimited interview preparation, resume tuning & mock sessions.
            </p>
            <button style={{ ...styles.primary, padding: "8px 14px", fontSize: 13, width: "100%", background: "linear-gradient(135deg, #10b981 0%, #059669 100%)" }}>
              Get Unlimited (₹1,999) →
            </button>
          </div>
        </div>
      </section>

      <footer style={styles.footer}>
        <a href="/privacy/" style={styles.link}>Privacy policy</a>
        <span aria-hidden> · </span>
        <a href="mailto:natraj22varma2@gmail.com" style={styles.link}>Contact & Support</a>
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "#64748b" }}>
          Ensure compliance with local regulations. Capture audio only with the consent of all meeting participants.
        </p>
      </footer>

      {showDemo && (
        <InteractiveDemo
          onClose={() => setShowDemo(false)}
          onGoToPricing={() => setShowPricing(true)}
        />
      )}

      {showPricing && (
        <SubscriptionPricing
          onClose={() => setShowPricing(false)}
          onPaymentSuccess={() => {
            setShowPricing(false);
            if (onSignUp) onSignUp();
            else onSignIn();
          }}
        />
      )}
    </main>
  );
}

const styles = {
  page: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    minHeight: "100vh",
    background: "#080a11",
    color: "#f8fafc",
    padding: "0 20px 48px",
    boxSizing: "border-box",
  },
  nav: {
    maxWidth: 1040,
    margin: "0 auto",
    padding: "20px 0",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
    borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
  },
  brand: { display: "flex", alignItems: "center", gap: 8 },
  logoDot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: "#4f46e5",
    boxShadow: "0 0 12px #6366f1",
  },
  brandText: { fontSize: 20, fontWeight: 800, letterSpacing: -0.5, color: "#ffffff" },
  badgePro: {
    fontSize: 10,
    fontWeight: 800,
    background: "rgba(99, 102, 241, 0.2)",
    color: "#818cf8",
    padding: "2px 6px",
    borderRadius: 4,
    border: "1px solid rgba(99, 102, 241, 0.3)",
  },
  navActions: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  navBtn: {
    background: "none",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    color: "#cbd5e1",
    padding: "8px 14px",
    borderRadius: 8,
    fontSize: 13,
    cursor: "pointer",
  },
  navPrimary: {
    background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
    border: 0,
    color: "#ffffff",
    padding: "8px 18px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 2px 12px rgba(99, 102, 241, 0.4)",
  },
  hero: { maxWidth: 840, margin: "0 auto", padding: "64px 0 40px", textAlign: "center" },
  tagline: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 14px",
    borderRadius: 999,
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 1.1,
    background: "rgba(99, 102, 241, 0.15)",
    color: "#a5b4fc",
    border: "1px solid rgba(99, 102, 241, 0.3)",
    marginBottom: 20,
  },
  heroTitle: {
    fontSize: "clamp(32px, 5vw, 54px)",
    lineHeight: 1.15,
    fontWeight: 800,
    letterSpacing: -1,
    margin: "0 0 18px",
    color: "#ffffff",
  },
  gradientText: {
    background: "linear-gradient(135deg, #818cf8 0%, #c084fc 100%)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  lead: {
    fontSize: 17,
    lineHeight: 1.6,
    color: "#94a3b8",
    margin: "0 auto 32px",
    maxWidth: 680,
  },
  actions: { display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", marginBottom: 40 },
  primary: {
    padding: "13px 28px",
    border: 0,
    borderRadius: 12,
    background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
    color: "#fff",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 4px 20px rgba(99, 102, 241, 0.4)",
  },
  demoAction: {
    padding: "13px 24px",
    borderRadius: 12,
    border: "1px solid rgba(255, 255, 255, 0.16)",
    color: "#ffffff",
    fontSize: 15,
    background: "rgba(255, 255, 255, 0.05)",
    cursor: "pointer",
  },
  secondary: {
    padding: "13px 24px",
    borderRadius: 12,
    border: "1px solid rgba(255, 255, 255, 0.16)",
    color: "#e2e8f0",
    fontSize: 15,
    textDecoration: "none",
    background: "rgba(255, 255, 255, 0.03)",
  },
  statsRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
    flexWrap: "wrap",
    padding: "18px 24px",
    borderRadius: 14,
    background: "rgba(255, 255, 255, 0.02)",
    border: "1px solid rgba(255, 255, 255, 0.06)",
    maxWidth: 680,
    margin: "0 auto",
  },
  statItem: { display: "flex", flexDirection: "column", gap: 2 },
  statDivider: { width: 1, height: 28, background: "rgba(255, 255, 255, 0.1)" },
  grid: {
    maxWidth: 960,
    margin: "0 auto 48px",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 20,
  },
  card: {
    background: "linear-gradient(145deg, #10131e 0%, #0d0f17 100%)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: 16,
    padding: 24,
    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
  },
  cardIcon: { fontSize: 28, marginBottom: 12 },
  h2: { margin: "0 0 8px", fontSize: 19, fontWeight: 700, color: "#f8fafc" },
  cardText: { margin: 0, fontSize: 13.5, color: "#94a3b8", lineHeight: 1.6 },
  pricingTeaser: {
    maxWidth: 820,
    margin: "0 auto 48px",
    textAlign: "center",
    padding: "36px 24px",
    borderRadius: 20,
    background: "rgba(255, 255, 255, 0.02)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
  },
  pricingCards: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 16,
    textAlign: "left",
  },
  priceCardSmall: {
    background: "rgba(20, 24, 36, 0.6)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: 14,
    padding: 20,
  },
  priceCardBadge: {
    fontSize: 10,
    fontWeight: 800,
    color: "#38bdf8",
    background: "rgba(56, 189, 248, 0.15)",
    padding: "3px 8px",
    borderRadius: 4,
    display: "inline-block",
  },
  footer: { maxWidth: 900, margin: "32px auto 0", textAlign: "center", fontSize: 13, color: "#64748b" },
  link: { color: "#818cf8", textDecoration: "none" },
};
