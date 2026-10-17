import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { restoreCaptureProtection, changeCaptureProtection } from "./capture-protection.mjs";
import CaptureProtectionSettings from "./CaptureProtectionSettings";
import DesktopDownload from "./DesktopDownload";
import { authFetch } from "./auth.mjs";
import { transcribeAudio } from "./transcription.mjs";
import { splitBold } from "./rich-text.mjs";
import { fetchSubscriptionStatus } from "./subscriptions.mjs";
import SubscriptionPricing from "./SubscriptionPricing";
import UserProfileModal from "./UserProfileModal";
import "./overlay.css";

// Vite proxies API requests; FastAPI serves them directly in the desktop app.
const API = import.meta.env.VITE_API_URL || "";
const CHUNK_MS = 6000;
const SILENCE_PEAK = 0.02; // max |sample| below this for a whole chunk = silence
const load = (k, d = "") => localStorage.getItem(k) ?? d;
const desktop = window.desktop; // exposed by the Electron preload script
// On Linux the desktop app records its default input, which it routes to the PulseAudio monitor (system audio).
const useDeviceInput = desktop?.platform === "linux";

const notifyExpired = () => window.dispatchEvent(new Event("auth-expired"));
const hasAvailableCall = (subscription) =>
  subscription?.status === "active" &&
  (subscription.calls_remaining === null || subscription.calls_remaining > 0 ||
    subscription.call_time_remaining_seconds > 0);

export default function App({ onSignOut, currentUser = null, isAdmin = false, initialSubscription = null, localNetwork = true, storeUrl = null }) {
  const [resume, setResume] = useState(load("resume"));
  const [jd, setJd] = useState(load("jd"));
  const [transcript, setTranscript] = useState("");
  const [manualQ, setManualQ] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [listening, setListening] = useState(false);
  const [audioMode, setAudioMode] = useState(load("audioMode", desktop?.platform === "win32" ? "both" : "system"));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const historyRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const audioCtxRef = useRef(null);
  const [onTop, setOnTop] = useState(load("onTop", "true") === "true");
  const [opacity, setOpacity] = useState(Number(load("opacity", "0.85")));
  const [captureProtection, setCaptureProtection] = useState({ supported: false, requested: false, status: "loading" });
  const [capturePending, setCapturePending] = useState(true);
  const [captureError, setCaptureError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [subscription, setSubscription] = useState(initialSubscription);
  const [subExpired, setSubExpired] = useState(!hasAvailableCall(initialSubscription));
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [tokenUsage, setTokenUsage] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    fetchSubscriptionStatus(API, fetch, localStorage, notifyExpired)
      .then((data) => {
        setTokenUsage(data.token_usage);
        if (data.has_active && data.subscription) {
          setSubscription(data.subscription);
          setSubExpired(!hasAvailableCall(data.subscription));
        } else {
          setSubscription(null);
          setSubExpired(true);
        }
      })
      .catch(() => {});
  }, []);

  function openProfile() {
    setShowProfileModal(true);
    setProfileLoading(true);
    setProfileError("");
    setTokenUsage(null);
    fetchSubscriptionStatus(API, fetch, localStorage, notifyExpired)
      .then((data) => {
        setSubscription(data.subscription);
        setSubExpired(!hasAvailableCall(data.subscription));
        setTokenUsage(data.token_usage);
      })
      .catch((error) => setProfileError(`Cannot load usage: ${error.message}`))
      .finally(() => setProfileLoading(false));
  }

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    restoreCaptureProtection(desktop, localStorage)
      .then(({ state, error }) => {
        if (active) { setCaptureProtection(state); setCaptureError(error); }
      })
      .catch((e) => { if (active) setCaptureError("Cannot read capture protection: " + e.message); })
      .finally(() => { if (active) setCapturePending(false); });
    return () => { active = false; };
  }, []);

  async function requestCaptureProtection(enabled) {
    setCapturePending(true);
    setCaptureError("");
    try {
      const state = await changeCaptureProtection(desktop, localStorage, enabled);
      setCaptureProtection(state);
    } catch (error) {
      setCaptureError("Cannot change capture protection: " + error.message);
      if (typeof error.requested === "boolean") {
        setCaptureProtection((state) => ({ ...state, requested: error.requested, status: "failed", error: error.message }));
      }
    } finally {
      setCapturePending(false);
    }
  }

  useEffect(() => localStorage.setItem("resume", resume), [resume]);
  useEffect(() => localStorage.setItem("jd", jd), [jd]);
  useEffect(() => localStorage.setItem("opacity", String(opacity)), [opacity]);
  useEffect(() => localStorage.setItem("audioMode", audioMode), [audioMode]);
  useEffect(() => {
    if (!desktop) return;
    localStorage.setItem("onTop", String(onTop));
    desktop.setAlwaysOnTop(onTop);
  }, [onTop]);
  useEffect(() => {
    if (!desktop) return;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    document.body.style.margin = "0";
  }, []);
  async function sendChunk(blob) {
    try {
      const text = await transcribeAudio(API, blob, fetch, localStorage, notifyExpired);
      if (text.trim()) setTranscript((t) => (t + " " + text.trim()).slice(-20000));
    } catch (e) {
      if (e.message && (e.message.includes("402") || e.message.toLowerCase().includes("subscription"))) {
        stopListening();
        setSubExpired(true);
        setStatus("Subscription expired. Please renew access.");
        return;
      }
      setStatus("Transcription error: " + e.message);
    }
  }

  // Each cycle creates a fresh MediaRecorder so every chunk is a standalone, decodable file.
  // Silent chunks are skipped: Whisper hallucinates words ("you", "Thanks for watching") on silence.
  function recordCycle(audioStream, analyser) {
    const rec = new MediaRecorder(audioStream, { mimeType: "audio/webm" });
    const parts = [];
    const buf = new Float32Array(analyser.fftSize);
    let peak = 0;
    const meter = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
    }, 100);
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = () => {
      clearInterval(meter);
      if (peak > SILENCE_PEAK) sendChunk(new Blob(parts, { type: "audio/webm" }));
    };
    rec.start();
    timerRef.current = setTimeout(() => {
      if (rec.state === "recording") rec.stop();
      if (streamRef.current) recordCycle(audioStream, analyser);
    }, CHUNK_MS);
  }

  async function startListening() {
    if (subExpired) {
      handleRenewClick();
      return;
    }
    const streams = [];
    const warnings = [];
    try {
      if (audioMode !== "microphone") {
        let system;
        try {
          system = useDeviceInput
            ? await navigator.mediaDevices.getUserMedia({
              audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
            })
            : await navigator.mediaDevices.getDisplayMedia({
              audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
              video: true,
            });
          system.getVideoTracks().forEach((track) => {
            track.stop();
            system.removeTrack(track);
          });
          if (!system.getAudioTracks().length) {
            throw new Error("No system audio was shared.");
          }
          streams.push(system);
        } catch (error) {
          system?.getTracks().forEach((track) => track.stop());
          if (audioMode !== "both") throw error;
          warnings.push(`System audio unavailable: ${error.message}`);
        }
      }
      if (audioMode === "both" || audioMode === "microphone") {
        let mic;
        try {
          mic = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
          });
          if (!mic.getAudioTracks().length) throw new Error("No microphone audio is available.");
          streams.push(mic);
        } catch (error) {
          mic?.getTracks().forEach((track) => track.stop());
          if (audioMode !== "both") throw error;
          warnings.push(`Microphone unavailable: ${error.message}`);
        }
      }
      if (!streams.length) throw new Error(warnings.join(" "));
      const audioTracks = streams.flatMap((stream) => stream.getAudioTracks());
      streamRef.current = new MediaStream(audioTracks);
      audioTracks.forEach((track) => { track.onended = stopListening; });
      audioCtxRef.current = new AudioContext();
      await audioCtxRef.current.resume();

      const destination = audioCtxRef.current.createMediaStreamDestination();
      const analyser = audioCtxRef.current.createAnalyser();
      analyser.fftSize = 2048;
      for (const stream of streams) {
        const source = audioCtxRef.current.createMediaStreamSource(stream);
        const highpass = audioCtxRef.current.createBiquadFilter();
        highpass.type = "highpass";
        highpass.frequency.value = 80;
        source.connect(highpass);
        highpass.connect(destination);
        highpass.connect(analyser);
      }

      recordCycle(destination.stream, analyser);
      setListening(true);
      if (warnings.length) console.warn("Audio capture is partial:", warnings.join(" "));
      setStatus(warnings.length ? `Listening with one source. ${warnings.join(" ")}` : "Listening…");
    } catch (e) {
      streams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
      // Logged via console.error so it lands in the desktop app's persistent log file
      // (desktop/main.js forwards renderer console output there) for support/debugging.
      console.error("startListening failed:", e);
      stopListening();
      setStatus("Capture failed: " + e.message);
    }
  }

  function stopListening() {
    clearTimeout(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setListening(false);
    setStatus("Stopped.");
  }

  async function getAnswer() {
    if (subExpired) {
      handleRenewClick();
      return;
    }
    setBusy(true);
    setAnswer("");
    setQuestion("");
    try {
      const r = await authFetch(`${API}/api/v1/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: manualQ, transcript, resume, job_description: jd, history: historyRef.current }),
      }, fetch, localStorage, notifyExpired);
      if (!r.ok) {
        const detail = (await r.json()).detail;
        throw new Error(`HTTP ${r.status}: ${detail}`);
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let answeredQuestion = "";
      let answeredText = "";
      let completed = false;
      let failed = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop();
        for (const ev of events) {
          const evName = ev.match(/^event: (.*)$/m)?.[1];
          const data = ev.match(/^data: (.*)$/m)?.[1];
          if (data == null) continue;
          const val = JSON.parse(data);
          if (evName === "question") {
            answeredQuestion = val;
            setQuestion(val);
          } else if (evName === "done") completed = true;
          else if (evName === "error") {
            failed = true;
            setAnswer((a) => a + val);
          } else if (!evName) {
            answeredText += val;
            setAnswer((a) => a + val);
          }
        }
      }
      if (completed && !failed && answeredQuestion && answeredText) {
        historyRef.current = [...historyRef.current, {
          question: answeredQuestion.slice(0, 500),
          answer: answeredText.slice(0, 4000),
        }].slice(-2);
      }
      setManualQ("");
    } catch (e) {
      if (e.message && (e.message.includes("402") || e.message.toLowerCase().includes("subscription"))) {
        setSubExpired(true);
        setAnswer("⚠️ Subscription expired or call allowance used. Please renew access to continue.");
      } else {
        setAnswer("Error: " + e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function handleRenewClick() {
    if (desktop && typeof desktop.openExternal === "function") {
      const publicOrigin = window.location.origin;
      desktop.openExternal(`${publicOrigin}/?renew=1`);
    } else {
      setShowPricingModal(true);
    }
  }

  const chips = (() => {
    const words = transcript.trim().split(/\s+/).filter(Boolean).slice(-12);
    const out = [];
    for (let i = 0; i < words.length; i += 3) out.push(words.slice(i, i + 3).join(" "));
    return out;
  })();
  const sourceHint = desktop?.platform === "win32"
    ? "Both records meeting audio and your microphone. Microphone-only avoids Windows screen capture and its cursor flicker; system audio requires a brief screen-capture start."
    : desktop?.platform === "darwin"
      ? "Captures desktop audio on macOS when your system route permits loopback."
      : !desktop
        ? "The browser requires a screen/tab picker: choose the meeting tab and enable tab audio."
        : "Captures the configured audio source for transcription.";

  const panel = (
    <main className={`hud${desktop ? " hud-desktop" : ""}`} style={{ "--hud-opacity": opacity }}>
      <div className={`hud-bar${desktop ? " hud-drag" : ""}`}>
        <button className={`hud-pill hud-listen${listening ? " on" : ""}`} onClick={listening ? stopListening : startListening}
          title={listening ? "Stop listening" : desktop ? "Listen to system audio" : "Listen to meeting tab"}>
          <span className={`hud-dot${listening ? " live" : ""}`} />
          {listening ? "Stop" : "Listen"}
        </button>
        <button className="hud-pill" disabled={busy} onClick={getAnswer} title="Get answer (Enter)">
          {busy ? "Thinking…" : "Answer"} <kbd>↵</kbd>
        </button>
        <button className="hud-pill" onClick={() => setTranscript("")} title="Clear transcript">Clear</button>
        <span className="hud-spacer" />
        <button
          className="hud-pill hud-profile-pill"
          onClick={openProfile}
          title="Account Profile & Credits"
        >
          <span className="hud-profile-dot" style={{ background: subscription ? "#4ade80" : "#f87171" }} />
          <span>{currentUser || "Profile"}</span>
          <span className="hud-plan-tag">{subscription ? subscription.plan_name.split(" ")[0] : "Free"}</span>
        </button>
        <button className="hud-icon" onClick={() => setMenuOpen((v) => !v)} title="Quick Settings" aria-expanded={menuOpen}>⋮</button>
        {desktop ? (
          <>
            <button className="hud-icon" onClick={() => desktop.minimize()} title="Minimize">–</button>
            <button className="hud-pill hud-end" onClick={() => desktop.close()} title="Close">End</button>
          </>
        ) : null}
      </div>

      {!desktop && (
        <section className="hud-card" style={{ borderColor: "rgba(245, 158, 11, 0.4)", background: "rgba(245, 158, 11, 0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 18 }}>🛡️</span>
            <strong style={{ color: "#fbbf24", fontSize: 14 }}>Screen Share Protection Notice</strong>
          </div>
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "#cbd5e1", lineHeight: 1.5 }}>
            Web browsers <strong>cannot</strong> hide from screen sharing (Zoom, Teams, Google Meet). To prevent interviewers from seeing this window, please download and use the <strong>TechPrep Desktop App</strong> below.
          </p>
        </section>
      )}

      {!desktop && <DesktopDownload localNetwork={localNetwork} storeUrl={storeUrl} />}

      {subExpired && (
        <div className="hud-sub-expired">
          <span style={{ fontSize: 13, color: "#fecaca" }}>
            ⚠️ <strong>Subscription inactive or calls exhausted.</strong> Renew to enable AI answers &amp; transcription.
          </span>
          <button type="button" className="hud-renew-btn" onClick={handleRenewClick}>
            Renew Plan
          </button>
        </div>
      )}

      {showPricingModal && (
        <SubscriptionPricing
          currentSubscription={subscription}
          allowQrUpload={isAdmin}
          onClose={() => setShowPricingModal(false)}
          onPaymentSuccess={() => {
            setShowPricingModal(false);
            setSubExpired(false);
            fetchSubscriptionStatus(API, fetch, localStorage, notifyExpired)
              .then((d) => { setSubscription(d.subscription); setTokenUsage(d.token_usage); })
              .catch(() => {});
          }}
        />
      )}

      {showProfileModal && (
        <UserProfileModal
          user={currentUser}
          isAdmin={isAdmin}
          subscription={subscription}
          tokenUsage={tokenUsage}
          profileLoading={profileLoading}
          profileError={profileError}
          onClose={() => setShowProfileModal(false)}
          onOpenPricing={() => {
            setShowProfileModal(false);
            setShowPricingModal(true);
          }}
          onSignOut={onSignOut}
          storeUrl={storeUrl}
          localNetwork={localNetwork}
          desktop={desktop}
          resume={resume}
          setResume={setResume}
          jd={jd}
          setJd={setJd}
          opacity={opacity}
          setOpacity={setOpacity}
          onTop={onTop}
          setOnTop={setOnTop}
          captureProtection={captureProtection}
          capturePending={capturePending}
          captureError={captureError}
          requestCaptureProtection={requestCaptureProtection}
          audioMode={audioMode}
          setAudioMode={setAudioMode}
          listening={listening}
        />
      )}

      <div className="hud-bar hud-chips">
        <span className={`hud-eq${listening ? " live" : ""}`} aria-hidden>▮▮▮</span>
        {chips.length
          ? chips.map((c, i) => <span key={i} className="hud-chip">{c}</span>)
          : <span className="hud-muted">{status || "Live transcript will appear here…"}</span>}
      </div>

      {menuOpen && (
        <section className="hud-card hud-menu">
          <p className="hud-muted" style={{ marginTop: 0 }}>{sourceHint}</p>
          {desktop?.platform === "win32" && (
            <label className="hud-muted">Audio source:{" "}
              <select value={audioMode} disabled={listening} onChange={(e) => setAudioMode(e.target.value)}>
                <option value="both">System + microphone</option>
                <option value="system">System audio</option>
                <option value="microphone">Microphone only (no screen capture)</option>
              </select>
            </label>
          )}
          {useDeviceInput && (
            <p className="hud-muted" title="Set by the desktop app. Restart it after changing your output device.">
              Audio source: {/\.monitor$/.test(desktop.audioSource) ? "🔊 system audio" : "🎤"} ({desktop.audioSource})
            </p>
          )}
          <label className="hud-row">👁 Opacity
            <input type="range" min="0.2" max="1" step="0.05" value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
          </label>
          {desktop && (
            <label className="hud-row">
              <input type="checkbox" checked={onTop} onChange={(e) => setOnTop(e.target.checked)} /> 📌 Always on top
            </label>
          )}
          {desktop && (
            <CaptureProtectionSettings state={captureProtection} pending={capturePending} error={captureError}
              onRequest={requestCaptureProtection} cardStyle={{}} rowStyle={s.row} buttonStyle={{}} />
          )}
          <details>
            <summary>Profile (resume &amp; job description — saved locally)</summary>
            <textarea rows={4} placeholder="Paste your resume…" value={resume} onChange={(e) => setResume(e.target.value)} />
            <textarea rows={3} placeholder="Paste the job description…" value={jd} onChange={(e) => setJd(e.target.value)} />
          </details>
          <a href="/privacy/" target="_blank" rel="noopener noreferrer" style={{ color: "#95c8ff", fontSize: 13, marginRight: 12 }}>Privacy policy</a>
          <button className="hud-pill" onClick={onSignOut}>Sign out</button>
        </section>
      )}

      <section className="hud-card hud-qa">
        <div className="hud-row">
          <input
            placeholder="Optional: type the question (otherwise detected from the transcript)"
            value={manualQ}
            onChange={(e) => setManualQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && getAnswer()}
          />
        </div>
        {question && <p className="hud-q"><b>💬 Question:</b> {question}</p>}
        {(answer || busy) && (
          <div className="hud-a"><b>⭐ Answer:</b>
            <pre>{splitBold(answer).map((part, i) => part.bold ? <strong key={i}>{part.text}</strong> : part.text)}</pre>
          </div>
        )}
        {!question && !answer && !busy && <p className="hud-muted">Answers appear here.</p>}
        {status && chips.length > 0 && <p className="hud-muted hud-status">{status}</p>}
      </section>
    </main>
  );

  return panel;
}

const s = {
  page: { fontFamily: "system-ui, sans-serif", maxWidth: 900, margin: "0 auto", padding: 16, color: "#0f172a" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8 },
  drag: { WebkitAppRegion: "drag", userSelect: "none", cursor: "move", marginBottom: 8 },
  noDrag: { WebkitAppRegion: "no-drag" },
  winBtn: { border: 0, background: "transparent", fontSize: 16, cursor: "pointer", padding: "0 4px" },
  row: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  btn: { padding: "8px 14px", border: 0, borderRadius: 8, background: "#2563eb", color: "#fff", cursor: "pointer" },
  input: { padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" },
  ta: { width: "100%", marginTop: 8, padding: 8, borderRadius: 8, border: "1px solid #cbd5e1", boxSizing: "border-box" },
  transcript: { marginTop: 8, maxHeight: 140, overflowY: "auto", background: "#f8fafc", padding: 8, borderRadius: 8, fontSize: 14 },
  answer: { whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 16, lineHeight: 1.5, margin: 0 },
};
