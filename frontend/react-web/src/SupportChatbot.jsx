import { useEffect, useRef, useState } from "react";

// Curated FAQ knowledge base covering how to use TechPrep. Matched by keyword
// scoring so the assistant feels responsive without needing a backend call.
const FAQ = [
  {
    keywords: [
      "start", "begin", "how do i use", "get started", "first time", "onboard", "end to end",
      "step by step", "steps", "after login", "walkthrough", "whole process", "entire process", "full process",
    ],
    answer:
      "Here's the full journey, step by step:\n" +
      "1) Sign up with your email and password on the website.\n" +
      "2) Log in — you'll land on your Web Dashboard.\n" +
      "3) Choose a subscription: ₹199 Hourly Call or ₹1,999 Monthly, and complete payment (Razorpay card/UPI, or " +
      "scan the UPI QR and enter the UTR reference).\n" +
      "4) Once payment is verified, your plan activates instantly on the dashboard.\n" +
      "5) Download the desktop app for Windows or macOS from the dashboard and install it.\n" +
      "6) Sign in on the desktop app with the same account — this opens the invisible HUD overlay.\n" +
      "7) Add your resume and the job description in the app so answers are tailored to you.\n" +
      "8) Join your interview call as normal (Zoom/Teams/Meet). Start listening in the overlay — it captures the " +
      "interviewer's system audio and streams back concise, tailored suggested answers in real time, invisibly.\n" +
      "9) After the call, your usage (minutes or call count) is deducted from your active plan automatically.",
  },
  {
    keywords: ["download", "desktop app", "install", "windows", "mac", "macos", "app"],
    answer:
      "You can download the desktop app from the Web Dashboard after signing in — look for the \"Download Desktop App\" " +
      "section. It's available for Windows and macOS. The desktop app is required to run the live overlay; the browser " +
      "is only used to manage your account and subscription.",
  },
  {
    keywords: ["overlay", "hud", "invisible", "stealth", "screen share", "screen-share", "detect", "zoom", "teams", "meet"],
    answer:
      "The HUD overlay is a transparent, always-on-top glass window that floats on your desktop. It uses native OS-level " +
      "content protection, so it stays completely invisible to Zoom, Teams, and Google Meet screen shares — the " +
      "interviewer never sees it.",
  },
  {
    keywords: ["mic", "microphone", "audio", "listen", "hear", "system audio", "loopback"],
    answer:
      "TechPrep captures your PC's system/loopback audio directly — the sound coming out of your speakers during the " +
      "call — instead of using your microphone. This means it hears the interviewer's questions clearly with no echo " +
      "or background noise from your own voice.",
  },
  {
    keywords: ["resume", "cv", "job description", "jd", "tailor", "personalize", "customize"],
    answer:
      "Before a call, add your resume and the job description in the app. Every suggested answer is tailored to match " +
      "your background and the specific role, so responses sound natural and relevant to you.",
  },
  {
    keywords: [
      "dropped", "drop", "disconnect", "disconnected", "lost connection", "cut off", "call ended",
      "rejoin", "reconnect", "call fail", "call failed", "call closed",
    ],
    answer:
      "No need to buy again. On the ₹199 Hourly Call plan, your 60-minute window starts the moment your call first " +
      "begins — if it drops or disconnects, just reconnect and resume within that same 60 minutes at no extra charge. " +
      "You'd only need to purchase a new session if you reconnect after the full 60-minute window from the original " +
      "start has expired. The same applies to each call on the ₹1,999 Monthly plan.",
  },
  {
    keywords: ["price", "pricing", "cost", "plan", "subscription", "rupee", "₹", "inr", "plans available"],
    answer:
      "We have two plans:\n" +
      "• ₹199 — Hourly Call (pay-as-you-go, single interview)\n" +
      "• ₹1,999 — Monthly (30 one-hour calls over 30 days, best value)\n" +
      "Ask me \"what do I get for ₹199\" or \"what do I get for ₹1999\" for the full details of each.",
  },
  {
    keywords: ["199", "hourly call", "hourly plan", "pay as you go", "pay-as-you-go", "single call", "per call"],
    answer:
      "₹199 Hourly Call plan gives you:\n" +
      "• One full 60-minute live interview session with the invisible HUD overlay active.\n" +
      "• Real-time system-audio transcription of the interviewer's questions.\n" +
      "• AI-generated, resume- and job-description-tailored suggested answers streamed live during that call.\n" +
      "• Full stealth screen-share protection for that session.\n" +
      "It's ideal if you only have one interview coming up and want to pay per call rather than commit monthly.",
  },
  {
    keywords: [
      "1999", "monthly", "monthly plan", "monthly subscription", "best value", "most popular",
      "30 calls", "multiple calls", "multiple interviews",
    ],
    answer:
      "₹1,999 Monthly plan gives you:\n" +
      "• 30 one-hour live interview sessions, valid for 30 days from purchase.\n" +
      "• Same real-time audio transcription + resume/JD-tailored AI answers on every call.\n" +
      "• Full invisible HUD overlay + stealth screen-share protection on every call.\n" +
      "• Works out far cheaper per call than paying ₹199 each time if you have several interviews lined up (round " +
      "preparation, mock sessions, resume tuning, and the actual interviews) within the month.\n" +
      "Unused calls simply expire at the end of the 30-day window; renew anytime from the Web Dashboard.",
  },
  {
    keywords: ["payment", "razorpay", "upi", "utr", "qr", "card", "checkout", "verify payment", "transaction"],
    answer:
      "To pay, pick a plan on the Pricing screen and either complete checkout via Razorpay (card/UPI), or scan the " +
      "UPI QR code shown and pay manually, then enter the UTR/reference number so we can verify it. Once verified, " +
      "your plan activates immediately and you're ready to download or reopen the desktop app.",
  },
  {
    keywords: ["logout", "log out", "sign out", "signed in on another device", "minimize", "minimise", "restore", "shortcut"],
    answer:
      "If the desktop window gets minimized, it won't appear in your taskbar (that's by design, for stealth). Press " +
      "Ctrl+Shift+T (Windows/Linux) or Cmd+Shift+T (macOS) at any time to instantly restore it — no need to sign in " +
      "again. Only one desktop session can be active at a time per account.",
  },
  {
    keywords: ["slow", "delay", "latency", "lag", "fast", "speed", "response time"],
    answer:
      "Answers normally stream back in under a second. If responses feel slow, check your internet connection and " +
      "make sure you're not in a very noisy room — background noise can trigger extra processing. We continuously " +
      "tune this for speed.",
  },
  {
    keywords: ["thank you", "hallucinat", "wrong transcript", "random text", "weird text", "garbage"],
    answer:
      "Occasionally speech-to-text can insert stray phrases during silence — we actively filter these out. If you " +
      "notice odd text in your transcript, it's safe to ignore; it won't affect the quality of suggested answers.",
  },
  {
    keywords: ["privacy", "record", "data", "secure", "safe", "consent"],
    answer:
      "We only process audio during an active call to generate suggestions — please ensure you have consent from all " +
      "participants to capture audio, in line with local regulations. See our Privacy Policy link in the footer for " +
      "full details.",
  },
  {
    keywords: ["contact", "support", "help", "human", "email", "issue", "problem", "bug"],
    answer:
      "For anything this assistant can't resolve, email us directly at natraj22varma2@gmail.com and we'll help " +
      "promptly.",
  },
  {
    keywords: ["refund", "cancel", "money back"],
    answer:
      "For refund or cancellation requests, please reach out to natraj22varma2@gmail.com with your account email and " +
      "payment details, and we'll take care of it.",
  },
];

const GREETING =
  "Hi! I'm the TechPrep assistant. Ask me anything about setting up your account, the desktop app, pricing, or how " +
  "the invisible interview HUD works.";

const FALLBACK =
  "I don't have a ready answer for that yet, but our team can help — email natraj22varma2@gmail.com. In the " +
  "meantime, try asking about getting started, pricing, the desktop app, or privacy.";

function matchesKeyword(text, keyword) {
  if (/^\d+$/.test(keyword)) {
    return new RegExp(`\\b${keyword}\\b`).test(text);
  }
  return text.includes(keyword);
}

function findAnswer(question) {
  const text = question.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const entry of FAQ) {
    const score = entry.keywords.reduce((total, keyword) => (matchesKeyword(text, keyword) ? total + 1 : total), 0);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best ? best.answer : FALLBACK;
}

const SUGGESTIONS = [
  "Walk me through the steps after login",
  "What do I get for ₹199?",
  "What do I get for ₹1999?",
];

export default function SupportChatbot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([{ role: "bot", text: GREETING }]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, typing, open]);

  function ask(question) {
    const trimmed = question.trim();
    if (!trimmed) return;
    setMessages((previous) => [...previous, { role: "user", text: trimmed }]);
    setInput("");
    setTyping(true);
    const delay = 380 + Math.min(trimmed.length * 8, 500);
    setTimeout(() => {
      setMessages((previous) => [...previous, { role: "bot", text: findAnswer(trimmed) }]);
      setTyping(false);
    }, delay);
  }

  function handleSubmit(event) {
    event.preventDefault();
    ask(input);
  }

  return (
    <div style={styles.wrapper}>
      {open && (
        <div style={styles.panel} role="dialog" aria-label="TechPrep support assistant">
          <div style={styles.header}>
            <div style={styles.headerLeft}>
              <span style={styles.headerIcon}>✦</span>
              <div>
                <div style={styles.headerTitle}>TechPrep Concierge</div>
                <div style={styles.headerSubtitle}>Here to clear your doubts</div>
              </div>
            </div>
            <button
              type="button"
              style={styles.closeBtn}
              onClick={() => setOpen(false)}
              aria-label="Close chat"
            >
              ×
            </button>
          </div>

          <div style={styles.body} ref={bodyRef}>
            {messages.map((message, index) => (
              <div
                key={index}
                style={{
                  ...styles.bubbleRow,
                  justifyContent: message.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div style={message.role === "user" ? styles.bubbleUser : styles.bubbleBot}>{message.text}</div>
              </div>
            ))}
            {typing && (
              <div style={{ ...styles.bubbleRow, justifyContent: "flex-start" }}>
                <div style={styles.bubbleBot}>
                  <span style={styles.typingDot}>●</span>
                  <span style={{ ...styles.typingDot, animationDelay: "0.15s" }}>●</span>
                  <span style={{ ...styles.typingDot, animationDelay: "0.3s" }}>●</span>
                </div>
              </div>
            )}
            {messages.length === 1 && !typing && (
              <div style={styles.suggestions}>
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} type="button" style={styles.suggestionChip} onClick={() => ask(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form style={styles.inputRow} onSubmit={handleSubmit}>
            <input
              style={styles.input}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about pricing, setup, privacy…"
              aria-label="Type your question"
            />
            <button type="submit" style={styles.sendBtn} aria-label="Send">
              ➤
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        style={styles.launcher}
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? "Close support chat" : "Open support chat"}
      >
        {open ? "×" : "💬"}
      </button>

      <style>{`
        @keyframes techprep-chat-pulse {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

const GOLD = "#e8c15e";
const GOLD_SOFT = "rgba(232, 193, 94, 0.35)";

const styles = {
  wrapper: {
    position: "fixed",
    bottom: 24,
    right: 24,
    zIndex: 9999,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  launcher: {
    width: 60,
    height: 60,
    borderRadius: "50%",
    border: `1px solid ${GOLD_SOFT}`,
    background: "linear-gradient(145deg, #15172a 0%, #0a0b14 100%)",
    color: GOLD,
    fontSize: 24,
    cursor: "pointer",
    boxShadow: `0 8px 30px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255,255,255,0.04), 0 0 24px ${GOLD_SOFT}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: "auto",
  },
  panel: {
    width: 340,
    maxWidth: "calc(100vw - 32px)",
    height: 460,
    maxHeight: "calc(100vh - 140px)",
    marginBottom: 16,
    borderRadius: 20,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    background: "linear-gradient(165deg, #121428 0%, #0a0b14 60%, #07080f 100%)",
    border: `1px solid ${GOLD_SOFT}`,
    boxShadow: `0 20px 60px rgba(0, 0, 0, 0.65), 0 0 40px rgba(232, 193, 94, 0.12)`,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 18px",
    borderBottom: `1px solid rgba(232, 193, 94, 0.18)`,
    background: "linear-gradient(135deg, rgba(232,193,94,0.12) 0%, rgba(124,58,237,0.08) 100%)",
  },
  headerLeft: { display: "flex", alignItems: "center", gap: 10 },
  headerIcon: {
    width: 34,
    height: 34,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #e8c15e 0%, #b8860b 100%)",
    color: "#1a1206",
    fontSize: 16,
    fontWeight: 800,
    flexShrink: 0,
  },
  headerTitle: { fontSize: 14.5, fontWeight: 700, color: "#f8fafc", letterSpacing: 0.2 },
  headerSubtitle: { fontSize: 11.5, color: "#a8a29e", marginTop: 1 },
  closeBtn: {
    background: "none",
    border: 0,
    color: "#cbd5e1",
    fontSize: 20,
    cursor: "pointer",
    lineHeight: 1,
    padding: 4,
  },
  body: {
    flex: 1,
    overflowY: "auto",
    padding: "16px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  bubbleRow: { display: "flex" },
  bubbleBot: {
    background: "rgba(255, 255, 255, 0.06)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    color: "#e2e8f0",
    padding: "10px 13px",
    borderRadius: "14px 14px 14px 4px",
    fontSize: 13.5,
    lineHeight: 1.55,
    maxWidth: "86%",
    whiteSpace: "pre-line",
  },
  bubbleUser: {
    background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
    color: "#fff",
    padding: "10px 13px",
    borderRadius: "14px 14px 4px 14px",
    fontSize: 13.5,
    lineHeight: 1.5,
    maxWidth: "86%",
    whiteSpace: "pre-line",
  },
  typingDot: {
    display: "inline-block",
    animation: "techprep-chat-pulse 1s infinite",
    marginRight: 3,
    fontSize: 10,
  },
  suggestions: { display: "flex", flexDirection: "column", gap: 8, marginTop: 4 },
  suggestionChip: {
    textAlign: "left",
    background: "rgba(232, 193, 94, 0.08)",
    border: `1px solid ${GOLD_SOFT}`,
    color: GOLD,
    padding: "8px 12px",
    borderRadius: 10,
    fontSize: 12.5,
    cursor: "pointer",
  },
  inputRow: {
    display: "flex",
    gap: 8,
    padding: 12,
    borderTop: "1px solid rgba(255, 255, 255, 0.08)",
    background: "rgba(0, 0, 0, 0.2)",
  },
  input: {
    flex: 1,
    background: "rgba(255, 255, 255, 0.06)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: 10,
    padding: "9px 12px",
    color: "#f8fafc",
    fontSize: 13,
    outline: "none",
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    border: 0,
    background: "linear-gradient(135deg, #e8c15e 0%, #b8860b 100%)",
    color: "#1a1206",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    flexShrink: 0,
  },
};
