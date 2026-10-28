import { useState } from "react";
import ResumeUploadButton from "./ResumeUploadButton";

const DISMISS_KEY = "profileOnboardingDismissed";

export function shouldShowProfileOnboarding() {
  const load = (k) => localStorage.getItem(k) ?? "";
  return !localStorage.getItem(DISMISS_KEY) && !load("resume") && !load("jd");
}

// Shown once (per device) after signup/first launch when resume & job description are both
// empty, since the AI assistant relies on them for every answer. Fully optional/skippable —
// resume & JD vary per interview, so this just surfaces the existing paste/upload controls
// rather than forcing a one-time permanent profile.
export default function ProfileOnboarding({ resume, setResume, jd, setJd, onClose }) {
  const [localResume, setLocalResume] = useState(resume);
  const [localJd, setLocalJd] = useState(jd);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    onClose();
  }

  function saveAndContinue() {
    setResume(localResume);
    setJd(localJd);
    dismiss();
  }

  return (
    <div style={styles.overlay} onClick={dismiss}>
      <div style={styles.modal} onClick={(event) => event.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={styles.title}>Add your resume &amp; job description</h3>
          <button style={styles.closeBtn} onClick={dismiss} title="Close">✕</button>
        </div>
        <div style={styles.body}>
          <p style={{ color: "#cbd5e1", margin: 0, fontSize: 13 }}>
            The AI assistant uses these to tailor answers to your background and the role. Optional —
            you can skip this and add it later, and update it anytime per interview from the ⋮ menu.
          </p>

          <label style={styles.label}>Resume (experience, skills, projects)
            <textarea
              style={{ ...styles.input, height: 110, resize: "vertical" }}
              placeholder="Paste your resume contents…"
              value={localResume}
              onChange={(e) => setLocalResume(e.target.value)}
            />
          </label>
          <ResumeUploadButton onExtracted={setLocalResume} />

          <label style={styles.label}>Target job description
            <textarea
              style={{ ...styles.input, height: 90, resize: "vertical" }}
              placeholder="Paste the job description…"
              value={localJd}
              onChange={(e) => setLocalJd(e.target.value)}
            />
          </label>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" style={styles.secondaryBtn} onClick={dismiss}>Skip for now</button>
            <button type="button" style={styles.primaryBtn} onClick={saveAndContinue}>Save &amp; continue</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0, 0, 0, 0.6)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
  },
  modal: {
    width: 460, maxWidth: "90vw", background: "#10131d", border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: 14, color: "#f8fafc", boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5)",
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "16px 18px", borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
  },
  title: { margin: 0, fontSize: 16, fontWeight: 700 },
  closeBtn: {
    background: "transparent", border: "none", color: "#94a3b8", fontSize: 16, cursor: "pointer",
  },
  body: { display: "flex", flexDirection: "column", gap: 14, padding: 18 },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#cbd5e1" },
  input: {
    padding: "8px 10px", borderRadius: 8, border: "1px solid #334155", background: "#151b2b",
    color: "#fff", fontSize: 13, fontFamily: "inherit",
  },
  primaryBtn: {
    background: "linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)", color: "#080a11", border: "none",
    padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer",
  },
  secondaryBtn: {
    background: "transparent", color: "#cbd5e1", border: "1px solid #334155",
    padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
  },
};
