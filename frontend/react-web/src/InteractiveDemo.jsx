export default function InteractiveDemo({ onClose, onGoToPricing }) {
  return (
    <div style={styles.overlayBackdrop}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <div style={styles.badge}>PRODUCT WALKTHROUGH</div>
          <h2 style={styles.title}>See TechPrep in Action</h2>
          <p style={styles.subtitle}>
            Watch how TechPrep listens to your call's audio and drafts answers in real time. Use it where AI assistance is allowed, such as practice and mock interviews.
          </p>
        </div>

        <div style={styles.videoWrap}>
          <video
            style={styles.video}
            src="/demo/techprep-demo.mp4"
            controls
            autoPlay
            playsInline
          />
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
  videoWrap: {
    background: "#090b10",
    borderRadius: 14,
    border: "1px solid rgba(255, 255, 255, 0.1)",
    overflow: "hidden",
    marginBottom: 24,
  },
  video: {
    display: "block",
    width: "100%",
    maxHeight: "60vh",
    background: "#000",
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
