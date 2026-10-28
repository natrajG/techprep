import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { restoreCaptureProtection, changeCaptureProtection } from "./capture-protection.mjs";
import CaptureProtectionSettings from "./CaptureProtectionSettings";
import DesktopDownload from "./DesktopDownload";
import { authFetch } from "./auth.mjs";
import { transcribeAudio } from "./transcription.mjs";
import { startChunkRecorder, captureSystemAudio } from "./audio-capture.mjs";
import { splitBold } from "./rich-text.mjs";
import { clampHudOpacity, MIN_HUD_OPACITY } from "./hud-opacity.mjs";
import { fetchSubscriptionStatus, lowCallWarning, timeRemainingWarning, sendHeartbeat } from "./subscriptions.mjs";
import SubscriptionPricing from "./SubscriptionPricing";
import UserProfileModal from "./UserProfileModal";
import FeedbackModal from "./FeedbackModal";
import "./overlay.css";

// Vite proxies API requests; FastAPI serves them directly in the desktop app.
const API = import.meta.env.VITE_API_URL || "";
const load = (k, d = "") => localStorage.getItem(k) ?? d;
const desktop = window.desktop; // exposed by the Electron preload script
// On Linux the desktop app records its default input, which it routes to the PulseAudio monitor (system audio).
const useDeviceInput = desktop?.platform === "linux";

// Short acknowledgements that shouldn't trigger an auto-answer on their own (e.g. a stray "Thank you.").
const FILLER_WORDS = new Set([
  "thanks", "thank", "you", "ok", "okay", "yes", "no", "yeah", "yep",
  "sure", "alright", "cool", "right", "got", "it", "mm", "uh", "um", "hmm",
]);

// Whisper-family STT models fabricate these stock phrases (from their training captions) when fed
// near-silent/background-noise audio with no real speech. Nobody said them — drop them outright so
// they never pollute the transcript or trigger a spurious auto-answer.
const HALLUCINATED_PHRASES = new Set([
  "thank you", "thank you.", "thanks for watching", "thanks for watching.",
  "thank you for watching", "thank you for watching.", "please subscribe", "please subscribe.",
  "bye", "bye.", "bye-bye", "bye-bye.", "see you next time", "see you next time.",
  "i'll see you next time", "i'll see you next time.", "you", "you.",
]);

function isHallucinatedChunk(text) {
  const normalized = text.trim().toLowerCase().replace(/^[.!?\s]+|[.!?\s]+$/g, "");
  return HALLUCINATED_PHRASES.has(normalized) || HALLUCINATED_PHRASES.has(normalized + ".");
}

// Pace auto-scrolling while the answer streams in, instead of jumping to the bottom on every
// token, so each new line stays visible long enough to actually read before it scrolls away.
const ANSWER_AUTO_SCROLL_INTERVAL_MS = 600;

const notifyExpired = () => window.dispatchEvent(new Event("auth-expired"));
// Plans that grant a single call window tracked via call_time_remaining_seconds: the hourly
// paid plan and the free trial granted automatically at signup.
const SINGLE_CALL_PLANS = ["hourly_call", "free_trial"];
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
  const [captureStarting, setCaptureStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const historyRef = useRef([]);
  const streamRef = useRef(null);
  const sourceStreamsRef = useRef([]);
  const stopRecorderRef = useRef(null);
  const startingRef = useRef(false);
  const captureSessionRef = useRef(0);
  const transcriptEpochRef = useRef(0);
  const transcriptionQueueRef = useRef(Promise.resolve());
  const transcriptRef = useRef("");
  const lastAnsweredRef = useRef("");
  const autoAnswerPendingRef = useRef(null);
  const activityVersionRef = useRef(0);
  const busyRef = useRef(false);
  const audioCtxRef = useRef(null);
  const [onTop, setOnTop] = useState(load("onTop", "true") === "true");
  const [opacity, setOpacityState] = useState(() => clampHudOpacity(load("opacity", "0.85")));
  const setOpacity = (value) => setOpacityState(clampHudOpacity(value));
  const answerScrollRef = useRef(null);
  const followAnswerRef = useRef(true);
  const lastAnswerAutoScrollRef = useRef(0);
  const [captureProtection, setCaptureProtection] = useState({ supported: false, requested: false, status: "loading" });
  const [capturePending, setCapturePending] = useState(true);
  const [captureError, setCaptureError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [subscription, setSubscription] = useState(initialSubscription);
  const [subExpired, setSubExpired] = useState(!hasAvailableCall(initialSubscription));
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [tokenUsage, setTokenUsage] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");

  const lowCalls = lowCallWarning(subscription);
  const timeWarning = timeRemainingWarning(subscription);
  const wasListening = useRef(false);
  const refreshSubscription = useCallback(() => {
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
  // Heartbeat must resolve BEFORE the status refresh: otherwise a status check that lands
  // first (e.g. right after reopening the app post-disconnect) could see the un-extended,
  // already-elapsed valid_until and mark the subscription expired before the heartbeat gets
  // a chance to refund the disconnected time.
  const checkIn = useCallback(
    () => sendHeartbeat(API, fetch, localStorage, notifyExpired).then(refreshSubscription),
    [refreshSubscription]
  );

  useEffect(checkIn, [checkIn]);
  // A call is counted when it starts, so reload the balance once the user stops listening.
  useEffect(() => {
    if (wasListening.current && !listening) refreshSubscription();
    wasListening.current = listening;
  }, [listening, refreshSubscription]);
  // Poll while a single-call window (hourly plan or free trial) is running so the "time left"
  // warning appears even during one long continuous listening session, not just between calls.
  useEffect(() => {
    if (!SINGLE_CALL_PLANS.includes(subscription?.plan_id) || !Number.isFinite(subscription?.call_time_remaining_seconds)) return;
    const id = setInterval(refreshSubscription, 30000);
    return () => clearInterval(id);
  }, [subscription?.plan_id, subscription?.call_time_remaining_seconds, refreshSubscription]);

  // Send a periodic heartbeat while a call window is running. If the gap between heartbeats is
  // larger than expected (app lost power/network), the server refunds that gap to the call
  // window so a disconnect doesn't eat into paid call time.
  const callWindowRunning =
    subscription?.status === "active" &&
    ((SINGLE_CALL_PLANS.includes(subscription.plan_id) && subscription.session_start) ||
      (subscription.plan_id === "monthly" && subscription.call_time_remaining_seconds > 0));
  useEffect(() => {
    if (!callWindowRunning) return;
    const id = setInterval(checkIn, 15000);
    // Also check in immediately when the browser/app regains connectivity, so a reconnect is
    // detected (and any lost time refunded) as soon as possible rather than waiting for the
    // next interval tick.
    window.addEventListener("online", checkIn);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", checkIn);
    };
  }, [callWindowRunning, checkIn]);

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
  // Follow the streaming answer unless the user has scrolled up to read earlier text. While
  // streaming, pace the auto-scroll (instead of jumping to the bottom on every token) so lines
  // stay on screen long enough to read before the view advances; once the answer finishes, snap
  // straight to the end so nothing is left out of view.
  useEffect(() => {
    const box = answerScrollRef.current;
    if (!box) return;
    if (!answer) {
      followAnswerRef.current = true;
      lastAnswerAutoScrollRef.current = 0;
      box.scrollTop = 0;
      return;
    }
    if (!followAnswerRef.current) return;
    const scrollToEnd = (behavior) => box.scrollTo({ top: box.scrollHeight, behavior });
    if (!busy) {
      scrollToEnd("smooth");
      return;
    }
    const now = Date.now();
    if (now - lastAnswerAutoScrollRef.current >= ANSWER_AUTO_SCROLL_INTERVAL_MS) {
      lastAnswerAutoScrollRef.current = now;
      scrollToEnd("smooth");
    }
  }, [answer, question, busy]);
  function trackAnswerScroll(event) {
    const box = event.currentTarget;
    followAnswerRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  }
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
  function sendChunk(blob, epoch) {
    transcriptionQueueRef.current = transcriptionQueueRef.current.then(async () => {
      if (epoch !== transcriptEpochRef.current) return;
      try {
        const text = await transcribeAudio(API, blob, fetch, localStorage, notifyExpired);
        if (epoch === transcriptEpochRef.current && text.trim() && !isHallucinatedChunk(text)) {
          transcriptRef.current = (transcriptRef.current + " " + text.trim()).slice(-20000);
          setTranscript(transcriptRef.current);
          if (streamRef.current) setStatus("Listening…");
        }
      } catch (e) {
        if (epoch !== transcriptEpochRef.current) return;
        if (e.message && (e.message.includes("402") || e.message.toLowerCase().includes("subscription"))) {
          stopListening();
          setSubExpired(true);
          setStatus("Subscription expired. Please renew access.");
          return;
        }
        setStatus("Transcription error: " + e.message);
      }
    });
  }

  function clearTranscript() {
    transcriptEpochRef.current++;
    transcriptionQueueRef.current = Promise.resolve();
    transcriptRef.current = "";
    lastAnsweredRef.current = "";
    autoAnswerPendingRef.current = null;
    setTranscript("");
  }

  function isFillerOnly(text) {
    const words = text.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
    return words.length > 0 && words.every((word) => FILLER_WORDS.has(word));
  }

  function tryAutoAnswer() {
    const pending = autoAnswerPendingRef.current;
    if (!pending || busyRef.current) return;
    if (pending.captureSession !== captureSessionRef.current ||
        pending.epoch !== transcriptEpochRef.current ||
        pending.activity !== activityVersionRef.current || !streamRef.current) {
      autoAnswerPendingRef.current = null;
      return;
    }
    const fullTranscript = transcriptRef.current;
    const newSpeech = fullTranscript.startsWith(lastAnsweredRef.current)
      ? fullTranscript.slice(lastAnsweredRef.current.length).trim()
      : fullTranscript.trim();
    autoAnswerPendingRef.current = null;
    if (!newSpeech) return;
    lastAnsweredRef.current = fullTranscript;
    if (isFillerOnly(newSpeech)) return;
    setStatus("Answering after the speech pause…");
    getAnswer(newSpeech);
  }

  function queueAutoAnswer(captureSession) {
    const activity = activityVersionRef.current;
    const epoch = transcriptEpochRef.current;
    transcriptionQueueRef.current.then(() => {
      if (captureSession !== captureSessionRef.current ||
          activity !== activityVersionRef.current || epoch !== transcriptEpochRef.current) return;
      autoAnswerPendingRef.current = { captureSession, activity, epoch };
      tryAutoAnswer();
    });
  }

  async function startListening() {
    if (startingRef.current || streamRef.current) return;
    if (subExpired) {
      handleRenewClick();
      return;
    }
    startingRef.current = true;
    setCaptureStarting(true);
    const captureSession = ++captureSessionRef.current;
    transcriptEpochRef.current++;
    transcriptionQueueRef.current = Promise.resolve();
    lastAnsweredRef.current = transcriptRef.current;
    autoAnswerPendingRef.current = null;
    let system;
    try {
      if (useDeviceInput && !/\.monitor$/.test(desktop.audioSource)) {
        throw new Error("System audio monitor is unavailable. Check the default output device and restart TechPrep.");
      }
      system = await captureSystemAudio(navigator.mediaDevices, useDeviceInput);
      if (captureSession !== captureSessionRef.current) {
        system.getTracks().forEach((track) => track.stop());
        return;
      }
      if (!system.getAudioTracks().length) throw new Error("No system audio was shared.");
      system.getVideoTracks().forEach((track) => { track.enabled = false; });
      sourceStreamsRef.current = [system];
      const audioTracks = system.getAudioTracks();
      streamRef.current = new MediaStream(audioTracks);
      audioTracks.forEach((track) => {
        track.onended = () => {
          stopListening();
          setStatus("Audio source ended. Check the meeting's speaker output and restart Listen.");
        };
      });
      audioCtxRef.current = new AudioContext();
      await audioCtxRef.current.resume();
      if (captureSession !== captureSessionRef.current) return;

      const destination = audioCtxRef.current.createMediaStreamDestination();
      const analyser = audioCtxRef.current.createAnalyser();
      analyser.fftSize = 2048;
      const source = audioCtxRef.current.createMediaStreamSource(system);
      const highpass = audioCtxRef.current.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 80;
      source.connect(highpass);
      highpass.connect(destination);
      highpass.connect(analyser);

      stopRecorderRef.current = startChunkRecorder({
        stream: destination.stream,
        analyser,
        onCycleStart: () => transcriptEpochRef.current,
        onChunk: (blob, chunkEpoch) => {
          if (captureSession === captureSessionRef.current) sendChunk(blob, chunkEpoch);
        },
        onActivity: () => { activityVersionRef.current++; },
        onPause: () => queueAutoAnswer(captureSession),
        onSilence: () => {
          if (captureSession === captureSessionRef.current && streamRef.current) {
            setStatus(desktop?.platform === "win32"
              ? "No system audio detected. Set the meeting speaker to the Windows default output and restart Listen."
              : "No shared audio detected. Check the selected audio source and restart Listen.");
          }
        },
        onError: (error) => {
          stopListening();
          setStatus("Audio recording failed: " + error.message);
        },
      });
      if (!streamRef.current) {
        stopRecorderRef.current?.();
        stopRecorderRef.current = null;
        return;
      }
      setListening(true);
      setStatus("Listening…");
    } catch (e) {
      system?.getTracks().forEach((track) => track.stop());
      if (captureSession !== captureSessionRef.current) return;
      // Logged via console.error so it lands in the desktop app's persistent log file
      // (desktop/main.js forwards renderer console output there) for support/debugging.
      console.error("startListening failed:", e);
      stopListening();
      setStatus("Capture failed: " + e.message);
    } finally {
      startingRef.current = false;
      setCaptureStarting(false);
    }
  }

  function stopListening() {
    const wasStarting = startingRef.current;
    if (wasStarting) captureSessionRef.current++;
    autoAnswerPendingRef.current = null;
    stopRecorderRef.current?.();
    stopRecorderRef.current = null;
    sourceStreamsRef.current.forEach((stream) => stream.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    }));
    sourceStreamsRef.current = [];
    streamRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setListening(false);
    setStatus(wasStarting ? "Capture cancelled. Close any sharing dialog before restarting." : "Stopped.");
  }

  async function getAnswer(autoTranscript = null) {
    if (busyRef.current) return;
    if (subExpired) {
      handleRenewClick();
      return;
    }
    const requestedTranscript = autoTranscript ?? transcriptRef.current;
    const requestedQuestion = autoTranscript === null ? manualQ : "";
    if (!requestedQuestion.trim() && !requestedTranscript.trim()) {
      setStatus("No speech captured yet. Check the meeting's speaker output or type a question.");
      return;
    }
    if (autoTranscript === null) {
      lastAnsweredRef.current = transcriptRef.current;
      autoAnswerPendingRef.current = null;
    }
    busyRef.current = true;
    setBusy(true);
    setAnswer("");
    setQuestion("");
    try {
      const r = await authFetch(`${API}/api/v1/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: requestedQuestion, transcript: requestedTranscript,
          resume, job_description: jd, history: historyRef.current,
        }),
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
      if (autoTranscript === null) setManualQ("");
    } catch (e) {
      if (e.message && (e.message.includes("402") || e.message.toLowerCase().includes("subscription"))) {
        setSubExpired(true);
        setAnswer("⚠️ Subscription expired or call allowance used. Please renew access to continue.");
      } else {
        setAnswer("Error: " + e.message);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      tryAutoAnswer();
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
    ? "Records system sound playing through the Windows default output, including Teams and Google Meet. Your microphone is not recorded."
    : desktop?.platform === "darwin"
      ? "Captures desktop audio on macOS when your system route permits loopback."
      : !desktop
        ? "The browser requires a screen/tab picker: choose the meeting tab and enable tab audio."
        : "Captures the configured audio source for transcription.";

  const panel = (
    <main className={`hud${desktop ? " hud-desktop" : ""}`} style={{ "--hud-opacity": opacity }}>
      <div className={`hud-bar${desktop ? " hud-drag" : ""}`}>
        <button className={`hud-pill hud-listen${listening ? " on" : ""}`} onClick={listening || captureStarting ? stopListening : startListening}
          title={listening ? "Stop listening" : captureStarting ? "Cancel capture setup" : desktop ? "Listen to system audio" : "Listen to meeting tab"}>
          <span className={`hud-dot${listening ? " live" : ""}`} />
          {listening ? "Stop" : captureStarting ? "Cancel" : "Listen"}
        </button>
        <button className="hud-pill" disabled={busy} onClick={() => getAnswer()} title="Get answer (Enter)">
          {busy ? "Thinking…" : "Answer"} <kbd>↵</kbd>
        </button>
        <button className="hud-pill" onClick={clearTranscript} title="Clear transcript">Clear</button>
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

      {!subExpired && lowCalls && (
        <div className="hud-sub-low" role="status">
          <span style={{ fontSize: 13, color: "#fde68a" }}>
            ⚠️ <strong>Only {lowCalls.remaining} of {lowCalls.total} calls left.</strong> Renew soon so your next interview is not interrupted.
          </span>
          <button type="button" className="hud-renew-btn" onClick={handleRenewClick}>
            Renew Plan
          </button>
        </div>
      )}

      {!subExpired && timeWarning && (
        <div className="hud-sub-low" role="status">
          <span style={{ fontSize: 13, color: "#fde68a" }}>
            ⏳ <strong>Only {timeWarning.minutes} min{timeWarning.minutes === 1 ? "" : "s"} left in this call.</strong> Renew now to avoid losing AI answers mid-interview.
          </span>
          <button type="button" className="hud-renew-btn" onClick={handleRenewClick}>
            Renew Plan
          </button>
        </div>
      )}

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
          {useDeviceInput && (
            <p className="hud-muted" title="Set by the desktop app. Restart it after changing your output device.">
              Audio source: {/\.monitor$/.test(desktop.audioSource) ? "🔊 system audio" : "unavailable"} ({desktop.audioSource})
            </p>
          )}
          <label className="hud-row">👁 Background opacity
            <input type="range" min={MIN_HUD_OPACITY} max="1" step="0.05" value={opacity} onChange={(e) => setOpacity(e.target.value)} />
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
          <button className="hud-pill" onClick={() => setShowFeedback(true)}>💬 Send feedback</button>
          <button className="hud-pill" onClick={onSignOut}>Sign out</button>
        </section>
      )}

      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}

      <section className="hud-card hud-qa" ref={answerScrollRef} onScroll={trackAnswerScroll}>
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
