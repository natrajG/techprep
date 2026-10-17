import { useState } from "react";

export default function InteractiveDemo({ onClose, onGoToPricing }) {
  const [activeStep, setActiveStep] = useState(0);

  const steps = [
    {
      title: "1. Stealth Floating Overlay",
      badge: "Zero Desktop Clutter",
      desc: "TechPrep floats discreetly above your video call (Zoom, Teams, Google Meet, or browser tab) with customizable luxury glassmorphism transparency and always-on-top positioning.",
      highlight: "Excludes itself from screen shares & recordings automatically on Windows & macOS.",
    },
    {
      title: "2. Real-Time Audio Capture",
      badge: "Direct Loopback",
      desc: "Captures the interviewer's voice directly from your system audio loopback without annoying microphone feedback or echoes. High-speed speech-to-text models transcribe questions instantly.",
      highlight: "Silent pauses are intelligently filtered locally to eliminate latency and save bandwidth.",
    },
    {
      title: "3. Hyper-Tailored Answers",
      badge: "Context-Aware AI",
      desc: "The assistant matches your loaded Resume and Job Description against the interviewer's questions, delivering concise, professional talking points and code blocks in real time.",
      highlight: "Streamed token-by-token directly to your HUD so you're never left waiting.",
    },
  ];

  return (
    <div style={styles.overlayBackdrop}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <div style={styles.badge}>INTERACTIVE WALKTHROUGH</div>
          <h2 style={styles.title}>Experience TechPrep Luxury HUD</h2>
          <p style={styles.subtitle}>
            See how candidates secure top engineering & management offers with undetectable real-time AI assistance.
          </p>
        </div>

        <div style={styles.stepTabs}>
          {steps.map((s, idx) => (
            <button
              key={idx}
              onClick={() => setActiveStep(idx)}
              style={{
                ...styles.tabBtn,
                ...(activeStep === idx ? styles.tabBtnActive : {}),
              }}
            >
              {s.title}
            </button>
          ))}
        </div>

        <div style={styles.demoStage}>
          {/* Mock Video Call Screen */}
          <div style={styles.mockCallWindow}>
            <div style={styles.mockCallBar}>
              <span style={styles.mockDot}></span>
              <span style={styles.mockDot}></span>
              <span style={styles.mockDot}></span>
              <span style={styles.mockTitle}>Video Interview Call · Google Meet / Zoom</span>
            </div>
            <div style={styles.mockInterviewArea}>
              <div style={styles.mockAvatar}>Interviewer</div>
              <div style={styles.mockWaveform}>
                <span style={styles.waveBar}></span>
                <span style={{ ...styles.waveBar, height: 18 }}></span>
                <span style={{ ...styles.waveBar, height: 26 }}></span>
                <span style={{ ...styles.waveBar, height: 14 }}></span>
                <span style={{ ...styles.waveBar, height: 22 }}></span>
                <span style={{ ...styles.waveBar, height: 10 }}></span>
              </div>
              <div style={styles.mockSpeechBubble}>
                "Can you walk me through how you optimize database connection pools under high concurrency?"
              </div>
            </div>

            {/* Simulated Floating Glass HUD */}
            <div style={styles.simulatedHud}>
              <div style={styles.simulatedBar}>
                <span style={styles.hudLiveDot}></span>
                <strong style={{ fontSize: 12, color: "#fff" }}>TECHPREP HUD</strong>
                <span style={styles.hudBadge}>Protected Capture</span>
              </div>
              <div style={styles.simulatedBody}>
                <div style={styles.hudPrompt}>
                  <span style={{ color: "#a5b4fc", fontSize: 11 }}>Q: Database connection pools under concurrency</span>
                </div>
                <div style={styles.hudAnswer}>
                  <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: "#e2e8f0" }}>
                    <strong>Key Points:</strong><br />
                    • Set <code>max_connections</code> bounded to CPU cores: <code>pool = 2 × cores + disk_spindle</code>.<br />
                    • Use HikariCP / async pgpool with health checks and aggressive lease timeouts.<br />
                    • Prevent pool exhaustion via circuit breaker & token-bucket queues.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div style={styles.infoCard}>
            <div style={styles.infoBadge}>{steps[activeStep].badge}</div>
            <h3 style={styles.infoTitle}>{steps[activeStep].title}</h3>
            <p style={styles.infoDesc}>{steps[activeStep].desc}</p>
            <div style={styles.infoHighlight}>
              🛡️ <strong>Stealth Feature:</strong> {steps[activeStep].highlight}
            </div>
          </div>
        </div>

        <div style={styles.footer}>
          <button style={styles.secondaryBtn} onClick={onClose}>
            Back to Overview
          </button>
          <button
            style={styles.primaryBtn}
            onClick={() => {
              onClose();
              if (onGoToPricing) onGoToPricing();
            }}
          >
            Unlock Access & View Plans →
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlayBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(3, 7, 18, 0.82)",
    backdropFilter: "blur(12px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    padding: 16,
    boxSizing: "border-box",
  },
  modal: {
    background: "linear-gradient(145deg, #11141e 0%, #0d0f17 100%)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    boxShadow: "0 25px 60px rgba(0, 0, 0, 0.7), 0 0 40px rgba(99, 102, 241, 0.15)",
    borderRadius: 20,
    width: "100%",
    maxWidth: 880,
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
    background: "rgba(99, 102, 241, 0.2)",
    color: "#a5b4fc",
    border: "1px solid rgba(99, 102, 241, 0.35)",
    marginBottom: 8,
  },
  title: { margin: "0 0 6px", fontSize: 28, fontWeight: 700, letterSpacing: -0.5 },
  subtitle: { margin: "0 auto", fontSize: 14, color: "#94a3b8", maxWidth: 600, lineHeight: 1.5 },
  stepTabs: { display: "flex", gap: 8, justifyContent: "center", marginBottom: 20, flexWrap: "wrap" },
  tabBtn: {
    padding: "8px 16px",
    background: "rgba(255, 255, 255, 0.05)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: 999,
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  tabBtnActive: {
    background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
    color: "#ffffff",
    borderColor: "rgba(165, 180, 252, 0.4)",
    boxShadow: "0 0 15px rgba(99, 102, 241, 0.4)",
  },
  demoStage: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 16,
    alignItems: "stretch",
    marginBottom: 24,
  },
  mockCallWindow: {
    background: "#090b10",
    borderRadius: 14,
    border: "1px solid rgba(255, 255, 255, 0.1)",
    position: "relative",
    overflow: "hidden",
    minHeight: 280,
    display: "flex",
    flexDirection: "column",
  },
  mockCallBar: {
    padding: "8px 12px",
    background: "rgba(255, 255, 255, 0.04)",
    display: "flex",
    alignItems: "center",
    gap: 6,
    borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
  },
  mockDot: { width: 8, height: 8, borderRadius: "50%", background: "#475569" },
  mockTitle: { fontSize: 11, color: "#64748b", marginLeft: 6 },
  mockInterviewArea: {
    flex: 1,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    textAlign: "center",
  },
  mockAvatar: {
    width: 48,
    height: 48,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #334155, #1e293b)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    color: "#cbd5e1",
    fontWeight: 600,
    border: "2px solid #475569",
    marginBottom: 10,
  },
  mockWaveform: { display: "flex", alignItems: "center", gap: 3, marginBottom: 12 },
  waveBar: {
    width: 3,
    height: 12,
    background: "#38bdf8",
    borderRadius: 2,
    animation: "hud-pulse 1s infinite",
  },
  mockSpeechBubble: {
    background: "rgba(30, 41, 59, 0.8)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    padding: "8px 14px",
    borderRadius: 10,
    fontSize: 12,
    color: "#cbd5e1",
    maxWidth: 280,
    lineHeight: 1.4,
  },
  simulatedHud: {
    position: "absolute",
    right: 12,
    bottom: 12,
    width: "72%",
    background: "rgba(20, 24, 36, 0.88)",
    backdropFilter: "blur(12px)",
    border: "1px solid rgba(129, 140, 248, 0.35)",
    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5), 0 0 20px rgba(99, 102, 241, 0.2)",
    borderRadius: 12,
    overflow: "hidden",
  },
  simulatedBar: {
    padding: "6px 10px",
    background: "rgba(99, 102, 241, 0.15)",
    display: "flex",
    alignItems: "center",
    gap: 6,
    borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
  },
  hudLiveDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#22c55e",
    boxShadow: "0 0 6px #22c55e",
  },
  hudBadge: {
    marginLeft: "auto",
    fontSize: 9,
    padding: "2px 6px",
    borderRadius: 4,
    background: "rgba(34, 197, 94, 0.2)",
    color: "#4ade80",
  },
  simulatedBody: { padding: 10 },
  hudPrompt: { marginBottom: 6, borderBottom: "1px solid rgba(255, 255, 255, 0.06)", paddingBottom: 4 },
  hudAnswer: { maxHeight: 110, overflow: "hidden" },
  infoCard: {
    background: "rgba(255, 255, 255, 0.03)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: 14,
    padding: 20,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
  },
  infoBadge: {
    alignSelf: "flex-start",
    fontSize: 11,
    color: "#38bdf8",
    background: "rgba(56, 189, 248, 0.12)",
    padding: "3px 10px",
    borderRadius: 6,
    fontWeight: 700,
    marginBottom: 10,
  },
  infoTitle: { margin: "0 0 8px", fontSize: 20, color: "#f8fafc" },
  infoDesc: { margin: "0 0 16px", fontSize: 13.5, color: "#94a3b8", lineHeight: 1.6 },
  infoHighlight: {
    background: "rgba(30, 27, 75, 0.6)",
    border: "1px solid rgba(129, 140, 248, 0.2)",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 12.5,
    color: "#c7d2fe",
    lineHeight: 1.5,
  },
  footer: { display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 8 },
  secondaryBtn: {
    padding: "10px 20px",
    background: "rgba(255, 255, 255, 0.06)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    borderRadius: 10,
    color: "#e2e8f0",
    fontSize: 14,
    cursor: "pointer",
  },
  primaryBtn: {
    padding: "10px 24px",
    background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)",
    border: "1px solid rgba(165, 180, 252, 0.4)",
    borderRadius: 10,
    color: "#ffffff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 4px 20px rgba(99, 102, 241, 0.4)",
  },
};
