import Dialog from "./Dialog";

export default function InteractiveDemo({ onClose, onGoToPricing }) {
  return (
    <Dialog label="TechPrep product walkthrough" onClose={onClose}>
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
          <button className="tp-btn" onClick={onClose}>
            Back to Overview
          </button>
          <button
            className="tp-btn tp-btn-primary"
            onClick={() => {
              onClose();
              if (onGoToPricing) onGoToPricing();
            }}
          >
            Unlock Access & View Plans →
          </button>
        </div>
    </Dialog>
  );
}

const styles = {
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
  subtitle: { margin: "0 auto", fontSize: 14, color: "#aaa4bc", maxWidth: 600, lineHeight: 1.5 },
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
};
