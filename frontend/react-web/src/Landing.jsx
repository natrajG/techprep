export default function Landing({ onSignIn, storeUrl }) {
  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <h1 style={{ margin: "0 0 8px", fontSize: 40 }}>TechPrep</h1>
        <p style={styles.lead}>
          An interview practice assistant. Listen to a practice call or mock interview,
          get a live transcript, and receive suggested answers based on your own resume and job description.
        </p>
        <div style={styles.actions}>
          <button style={styles.primary} onClick={onSignIn}>Sign in</button>
          {storeUrl && (
            <a style={styles.secondary} href={storeUrl} target="_blank" rel="noopener noreferrer">
              Get it on Microsoft Store
            </a>
          )}
        </div>
      </section>

      <section style={styles.grid} aria-label="Features">
        <article style={styles.card}>
          <h2 style={styles.h2}>Live transcript</h2>
          <p>Capture the audio of a practice session and see the questions transcribed as they are asked.</p>
        </article>
        <article style={styles.card}>
          <h2 style={styles.h2}>Suggested answers</h2>
          <p>Get structured answer suggestions tailored to your resume and the role you are preparing for.</p>
        </article>
        <article style={styles.card}>
          <h2 style={styles.h2}>Desktop app</h2>
          <p>Windows 10/11 (64-bit) app with a compact, always-on-top window you can resize and make translucent.</p>
        </article>
      </section>

      <footer style={styles.footer}>
        <a href="/privacy/" style={styles.link}>Privacy policy</a>
        <span aria-hidden> · </span>
        <a href="mailto:natraj22varma2@gmail.com" style={styles.link}>Contact</a>
        <p style={{ margin: "10px 0 0" }}>Only capture audio with the consent of everyone on the call.</p>
      </footer>
    </main>
  );
}

const styles = {
  page: { fontFamily: "system-ui, sans-serif", minHeight: "100vh", background: "#f1f5f9", color: "#0f172a", padding: "0 20px 32px", boxSizing: "border-box" },
  hero: { maxWidth: 760, margin: "0 auto", padding: "64px 0 32px", textAlign: "center" },
  lead: { fontSize: 18, lineHeight: 1.6, color: "#334155", margin: "0 auto 24px", maxWidth: 640 },
  actions: { display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" },
  primary: { padding: "12px 24px", border: 0, borderRadius: 10, background: "#2563eb", color: "#fff", fontSize: 16, cursor: "pointer" },
  secondary: { padding: "12px 24px", borderRadius: 10, border: "1px solid #2563eb", color: "#2563eb", fontSize: 16, textDecoration: "none", background: "#fff" },
  grid: { maxWidth: 900, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 },
  card: { background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 2px 12px #0f172a14", lineHeight: 1.55 },
  h2: { margin: "0 0 8px", fontSize: 18 },
  footer: { maxWidth: 900, margin: "32px auto 0", textAlign: "center", fontSize: 14, color: "#475569" },
  link: { color: "#1747a5" },
};
