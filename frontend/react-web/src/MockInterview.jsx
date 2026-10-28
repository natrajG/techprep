import { useEffect, useRef, useState } from "react";
import { fetchMockFeedback, fetchNextQuestion } from "./mock-interview.mjs";
import { getMicStream, startSingleTakeRecording } from "./mock-recorder.mjs";

const API = import.meta.env.VITE_API_URL || "";
const ROLE_STORAGE_KEY = "mock_interview_role";
const notifyExpired = () => window.dispatchEvent(new Event("auth-expired"));
const speechSupported = typeof window !== "undefined" && "speechSynthesis" in window;

export default function MockInterview({ onClose }) {
  const [role, setRole] = useState(() => localStorage.getItem(ROLE_STORAGE_KEY) || "");
  const [started, setStarted] = useState(false);
  const [history, setHistory] = useState([]);
  const [current, setCurrent] = useState(null); // { question, sample_answer }
  const [feedback, setFeedback] = useState(null); // { transcript, words_per_minute, feedback }
  // idle(pre-start) | loading | ready | recording | analyzing | feedback
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState("");
  const recordingRef = useRef(null);
  const sampleRef = useRef(null);
  const scrollTimerRef = useRef(null);

  useEffect(() => () => {
    if (speechSupported) window.speechSynthesis.cancel();
    clearInterval(scrollTimerRef.current);
    if (recordingRef.current) {
      recordingRef.current.stream.getTracks().forEach((track) => track.stop());
    }
  }, []);

  // Gentle auto-scroll through the sample answer while reading, so a candidate can
  // practice explaining it aloud without having to scroll manually.
  useEffect(() => {
    clearInterval(scrollTimerRef.current);
    if (phase !== "ready" || !sampleRef.current) return undefined;
    const node = sampleRef.current;
    node.scrollTop = 0;
    scrollTimerRef.current = setInterval(() => {
      if (!node) return;
      if (node.scrollTop + node.clientHeight >= node.scrollHeight - 1) {
        clearInterval(scrollTimerRef.current);
        return;
      }
      node.scrollTop += 1;
    }, 140);
    return () => clearInterval(scrollTimerRef.current);
  }, [phase, current]);

  function speak(text) {
    if (!speechSupported) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.lang = "en-US";
    window.speechSynthesis.speak(utterance);
  }

  async function loadNext(nextHistory) {
    setError("");
    setFeedback(null);
    setPhase("loading");
    try {
      const data = await fetchNextQuestion(API, role.trim(), nextHistory, fetch, localStorage, notifyExpired);
      setCurrent(data);
      setPhase("ready");
      speak(data.question);
    } catch (e) {
      setError(e.message);
      setPhase(nextHistory.length ? "feedback" : "idle");
    }
  }

  function start() {
    const trimmed = role.trim();
    localStorage.setItem(ROLE_STORAGE_KEY, trimmed);
    setStarted(true);
    setHistory([]);
    loadNext([]);
  }

  function next() {
    const nextHistory = current ? [...history, current].slice(-20) : history;
    setHistory(nextHistory);
    loadNext(nextHistory);
  }

  async function startRecording() {
    setError("");
    try {
      const stream = await getMicStream();
      const recorder = startSingleTakeRecording(stream, {
        onError: (e) => { setError(e.message); setPhase("ready"); },
      });
      recordingRef.current = { stream, recorder };
      setPhase("recording");
    } catch {
      setError("Microphone access was denied. Allow microphone access in your browser to practice your answer aloud.");
    }
  }

  async function stopAndAnalyze() {
    const active = recordingRef.current;
    if (!active) return;
    setPhase("analyzing");
    try {
      const { blob, durationSeconds } = await active.recorder.stop();
      active.stream.getTracks().forEach((track) => track.stop());
      recordingRef.current = null;
      const result = await fetchMockFeedback(API, {
        audio: blob, question: current.question, sampleAnswer: current.sample_answer, durationSeconds,
      }, fetch, localStorage, notifyExpired);
      setFeedback(result);
      setPhase("feedback");
    } catch (e) {
      recordingRef.current = null;
      setError(e.message);
      setPhase("ready");
    }
  }

  function cancelRecording() {
    const active = recordingRef.current;
    if (!active) return;
    active.recorder.stop();
    active.stream.getTracks().forEach((track) => track.stop());
    recordingRef.current = null;
    setPhase("ready");
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.panel}>
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>✨ Mock Interview Practice</h2>
            <p style={styles.subtitle}>Free read-aloud coaching · up to 20 questions a day · English only</p>
          </div>
          <button style={styles.closeBtn} onClick={onClose} title="Close">✕</button>
        </div>

        <div style={styles.body}>
          {!started && (
            <div style={styles.introCard}>
              <label style={styles.label}>
                Role or job description <span style={styles.optional}>(optional)</span>
                <textarea
                  style={{ ...styles.input, height: 100, resize: "vertical" }}
                  placeholder="e.g. Senior Backend Engineer — Python, distributed systems, AWS…"
                  maxLength={4000}
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                />
              </label>
              <p style={styles.introHint}>
                We'll generate a question, speak it aloud, and show you a model answer to practice
                explaining in your own words. Record yourself, and get feedback on pace and delivery.
              </p>
              <button style={styles.primaryBtn} onClick={start}>Start Practicing →</button>
            </div>
          )}

          {started && (
            <>
              <div style={styles.counterRow}>
                <span style={styles.counterPill}>Question {history.length + 1}</span>
                {!speechSupported && <span style={styles.warnPill}>Voice playback unsupported — text only</span>}
              </div>

              {phase === "loading" && <p style={styles.statusText}>Generating your next question…</p>}

              {(phase === "ready" || phase === "recording" || phase === "analyzing" || phase === "feedback") && current && (
                <div style={styles.questionCard}>
                  <div style={styles.questionRow}>
                    <span style={styles.questionIcon}>🎤</span>
                    <h3 style={styles.questionText}>{current.question}</h3>
                    {speechSupported && (
                      <button style={styles.ghostBtn} onClick={() => speak(current.question)} title="Hear the question again">
                        🔊
                      </button>
                    )}
                  </div>
                  <div style={styles.sampleLabel}>Sample answer — read it aloud, in your own words</div>
                  <div ref={sampleRef} style={styles.sampleBox}>{current.sample_answer}</div>
                </div>
              )}

              {phase === "ready" && (
                <div style={styles.controlsRow}>
                  <button style={styles.primaryBtn} onClick={startRecording}>● Record My Answer</button>
                  <button style={styles.secondaryBtn} onClick={next}>Skip → Next Question</button>
                </div>
              )}

              {phase === "recording" && (
                <div style={styles.controlsRow}>
                  <span style={styles.recordingIndicator}>● Recording…</span>
                  <button style={styles.primaryBtn} onClick={stopAndAnalyze}>Stop &amp; Analyze</button>
                  <button style={styles.secondaryBtn} onClick={cancelRecording}>Cancel</button>
                </div>
              )}

              {phase === "analyzing" && <p style={styles.statusText}>Transcribing and analyzing your delivery…</p>}

              {phase === "feedback" && feedback && (
                <div style={styles.feedbackCard}>
                  <div style={styles.feedbackStatsRow}>
                    <div style={styles.statBox}>
                      <span style={styles.statLabel}>Pace</span>
                      <strong style={styles.statValue}>
                        {feedback.words_per_minute > 0 ? `${feedback.words_per_minute} wpm` : "—"}
                      </strong>
                    </div>
                  </div>
                  <p style={styles.feedbackText}>{feedback.feedback}</p>
                  {feedback.transcript && (
                    <details style={styles.transcriptDetails}>
                      <summary style={styles.transcriptSummary}>What we heard</summary>
                      <p style={styles.transcriptText}>{feedback.transcript}</p>
                    </details>
                  )}
                  <div style={styles.controlsRow}>
                    <button style={styles.primaryBtn} onClick={next}>Next Question →</button>
                  </div>
                </div>
              )}

              {error && <p role="alert" style={styles.errorText}>{error}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(5, 6, 12, 0.78)", backdropFilter: "blur(6px)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20,
  },
  panel: {
    width: 720, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto",
    background: "linear-gradient(165deg, rgba(24, 20, 45, 0.95) 0%, rgba(13, 16, 28, 0.97) 60%)",
    border: "1px solid rgba(167, 139, 250, 0.25)", borderRadius: 20, color: "#f8fafc",
    boxShadow: "0 30px 90px rgba(99, 102, 241, 0.25), 0 0 0 1px rgba(255,255,255,0.03) inset",
  },
  header: {
    display: "flex", alignItems: "flex-start", justifyContent: "space-between",
    padding: "22px 26px 16px", borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
  },
  title: {
    margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em",
    background: "linear-gradient(135deg, #c4b5fd 0%, #38bdf8 100%)",
    WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
  },
  subtitle: { margin: "6px 0 0", fontSize: 12.5, color: "#a5b4cf" },
  closeBtn: {
    background: "rgba(255, 255, 255, 0.06)", border: "1px solid rgba(255, 255, 255, 0.1)",
    color: "#cbd5e1", borderRadius: 999, width: 30, height: 30, cursor: "pointer", flexShrink: 0,
  },
  body: { padding: "22px 26px 28px", display: "flex", flexDirection: "column", gap: 18 },
  introCard: { display: "flex", flexDirection: "column", gap: 14 },
  label: { display: "flex", flexDirection: "column", gap: 8, fontSize: 13.5, color: "#dbe2f5", fontWeight: 600 },
  optional: { color: "#7d8bab", fontWeight: 400 },
  input: {
    padding: "11px 13px", borderRadius: 12, border: "1px solid rgba(167, 139, 250, 0.3)",
    background: "rgba(10, 12, 22, 0.6)", color: "#fff", fontSize: 13.5, fontFamily: "inherit",
  },
  introHint: { margin: 0, fontSize: 12.5, color: "#8fa0c6", lineHeight: 1.6 },
  primaryBtn: {
    background: "linear-gradient(135deg, #a78bfa 0%, #38bdf8 100%)", color: "#0b0c14", border: "none",
    padding: "11px 20px", borderRadius: 12, fontSize: 13.5, fontWeight: 800, cursor: "pointer",
    boxShadow: "0 10px 28px rgba(99, 102, 241, 0.35)",
  },
  secondaryBtn: {
    background: "rgba(255, 255, 255, 0.05)", border: "1px solid rgba(255, 255, 255, 0.14)",
    color: "#cbd5e1", padding: "11px 18px", borderRadius: 12, fontSize: 13.5, fontWeight: 700, cursor: "pointer",
  },
  ghostBtn: {
    background: "rgba(255, 255, 255, 0.05)", border: "1px solid rgba(255, 255, 255, 0.1)",
    color: "#cbd5e1", borderRadius: 999, width: 30, height: 30, cursor: "pointer", flexShrink: 0, fontSize: 13,
  },
  counterRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  counterPill: {
    fontSize: 11.5, fontWeight: 800, padding: "4px 11px", borderRadius: 999, color: "#c4b5fd",
    background: "rgba(167, 139, 250, 0.14)", border: "1px solid rgba(167, 139, 250, 0.3)",
  },
  warnPill: {
    fontSize: 11, fontWeight: 600, padding: "4px 11px", borderRadius: 999, color: "#fde68a",
    background: "rgba(245, 158, 11, 0.12)", border: "1px solid rgba(251, 191, 36, 0.35)",
  },
  statusText: { color: "#a5b4cf", fontSize: 13.5, margin: 0 },
  questionCard: {
    background: "rgba(255, 255, 255, 0.03)", border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: 16, padding: 18, display: "flex", flexDirection: "column", gap: 12,
  },
  questionRow: { display: "flex", alignItems: "flex-start", gap: 10 },
  questionIcon: { fontSize: 18, lineHeight: 1.4 },
  questionText: { margin: 0, fontSize: 15.5, fontWeight: 700, lineHeight: 1.5, flex: 1, color: "#f1f5ff" },
  sampleLabel: { fontSize: 11.5, fontWeight: 700, color: "#7d8bab", textTransform: "uppercase", letterSpacing: "0.04em" },
  sampleBox: {
    maxHeight: 180, overflowY: "auto", fontSize: 13.5, lineHeight: 1.7, color: "#cdd6ee",
    background: "rgba(10, 12, 22, 0.55)", border: "1px solid rgba(255, 255, 255, 0.06)",
    borderRadius: 12, padding: "12px 14px", scrollBehavior: "smooth",
  },
  controlsRow: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  recordingIndicator: { color: "#f87171", fontWeight: 700, fontSize: 13.5 },
  feedbackCard: {
    background: "rgba(56, 189, 248, 0.06)", border: "1px solid rgba(56, 189, 248, 0.2)",
    borderRadius: 16, padding: 18, display: "flex", flexDirection: "column", gap: 14,
  },
  feedbackStatsRow: { display: "flex", gap: 12 },
  statBox: {
    background: "rgba(0, 0, 0, 0.2)", borderRadius: 10, padding: "8px 16px",
    display: "flex", flexDirection: "column", gap: 2,
  },
  statLabel: { fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.04em" },
  statValue: { fontSize: 16, fontWeight: 800, color: "#7dd3fc" },
  feedbackText: { margin: 0, fontSize: 13.5, lineHeight: 1.7, color: "#e2e8f0" },
  transcriptDetails: { fontSize: 12.5, color: "#94a3b8" },
  transcriptSummary: { cursor: "pointer", fontWeight: 600, color: "#a5b4cf" },
  transcriptText: { marginTop: 8, lineHeight: 1.6, color: "#9fb0d0" },
  errorText: { color: "#fca5a5", fontSize: 13, margin: 0 },
};
