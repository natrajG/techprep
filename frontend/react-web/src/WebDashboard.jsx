import { useEffect, useRef, useState } from "react";
import RecoveryEmail from "./RecoveryEmail";
import DesktopDownload from "./DesktopDownload";
import SubscriptionPricing from "./SubscriptionPricing";
import AdminPlans from "./AdminPlans";
import AdminFeedback from "./AdminFeedback";
import FeedbackModal from "./FeedbackModal";
import MockInterview from "./MockInterview";
import InterviewHistory from "./InterviewHistory";
import ResumeUploadButton from "./ResumeUploadButton";
import AtsScorePanel from "./AtsScorePanel";
import JobSearchPanel from "./JobSearchPanel";
import Icon from "./Icon";
import BrandMark from "./BrandMark";
import Dialog from "./Dialog";
import { lowCallWarning } from "./subscriptions.mjs";
import { getJobProfile } from "./job-profile.mjs";

const load = (k, d = "") => localStorage.getItem(k) ?? d;
const API = import.meta.env.VITE_API_URL || "";
const notifyExpired = () => window.dispatchEvent(new Event("auth-expired"));
const userKey = (user, key) => `tp:${(user || "").toLowerCase()}:${key}`;
const loadUserScoped = (user, key, fallback = "") => localStorage.getItem(userKey(user, key)) ?? load(key, fallback);

export default function WebDashboard({
  user,
  isAdmin,
  subscription,
  tokenUsage,
  onSignOut,
  passwordResetEnabled,
  storeUrl,
  localNetwork,
  onRefreshSubscription,
}) {
  const [showPricing, setShowPricing] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showMockInterview, setShowMockInterview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showAtsScore, setShowAtsScore] = useState(false);
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [resume, setResume] = useState(() => loadUserScoped(user, "resume"));
  const [jd, setJd] = useState(() => loadUserScoped(user, "jd"));
  const [resumeUploaded, setResumeUploaded] = useState(
    () => Boolean(localStorage.getItem("resume_uploaded_at") || localStorage.getItem(userKey(user, "resume_uploaded_at"))),
  );
  const [pasteMode, setPasteMode] = useState(false);
  const userMenuRef = useRef(null);
  useEffect(() => {
    setResume(loadUserScoped(user, "resume"));
    setJd(loadUserScoped(user, "jd"));
    setResumeUploaded(Boolean(localStorage.getItem(userKey(user, "resume_uploaded_at")) || localStorage.getItem("resume_uploaded_at")));
  }, [user]);
  useEffect(() => {
    let cancelled = false;
    if (!user) return () => {};
    getJobProfile(API, fetch, localStorage, notifyExpired)
      .then((profile) => {
        if (cancelled || !profile) return;
        if (!resume.trim() && profile.resume) setResume(profile.resume);
        if (!jd.trim() && profile.jd) setJd(profile.jd);
        if ((!resume.trim() && profile.resume) || Boolean(localStorage.getItem("resume_uploaded_at"))) {
          setResumeUploaded(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);
  useEffect(() => {
    localStorage.setItem("resume", resume);
    localStorage.setItem(userKey(user, "resume"), resume);
  }, [resume, user]);
  useEffect(() => {
    localStorage.setItem("jd", jd);
    localStorage.setItem(userKey(user, "jd"), jd);
  }, [jd, user]);
  useEffect(() => {
    if (resumeUploaded) {
      localStorage.setItem(userKey(user, "resume_uploaded_at"), localStorage.getItem("resume_uploaded_at") || String(Date.now()));
    }
  }, [resumeUploaded, user]);
  useEffect(() => {
    if (!resume.trim()) {
      localStorage.removeItem("resume_uploaded_at");
      localStorage.removeItem(userKey(user, "resume_uploaded_at"));
      setResumeUploaded(false);
    }
  }, [resume, user]);
  const hasActiveSub = subscription && subscription.status === "active";
  const lowCalls = lowCallWarning(subscription);
  const callsExhausted = hasActiveSub && subscription.calls_remaining === 0 &&
    subscription.call_time_remaining_seconds === 0;
  const needsSubscription = !hasActiveSub || callsExhausted;
  const timeLeftMinutes = subscription?.time_remaining_seconds
    ? Math.ceil(subscription.time_remaining_seconds / 60)
    : null;

  useEffect(() => {
    if (!showUserMenu) return;
    function handleClickOutside(event) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
    }
    function handleEsc(event) {
      if (event.key === "Escape") setShowUserMenu(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [showUserMenu]);

  return (
    <div className="tp-dashboard" id="workspace-top">
      <a className="tp-skip" href="#workspace-content">Skip to workspace</a>
      {/* Top Navbar */}
      <header className="tp-workspace-nav">
        <a className="tp-brand" href="#workspace-top" aria-label="TechPrep — Back to top">
          <BrandMark />
          TechPrep
        </a>
        <div className="tp-user-control" ref={userMenuRef}>
          <button
            type="button"
            className="tp-user-button"
            aria-label={`Account menu for ${user}`}
            onClick={() => setShowUserMenu((open) => !open)}
            aria-expanded={showUserMenu}
            aria-controls="account-navigation"
          >
            <span className="tp-user-avatar">{user?.slice(0, 1).toUpperCase()}</span>
            <span className="tp-user-name">{user}</span>
            {hasActiveSub && <span className="tp-pill tp-pill-violet">PRO</span>}
            <Icon name="chevron" size={15} />
          </button>
          {showUserMenu && (
            <div className="tp-user-dropdown" id="account-navigation">
              <button
                type="button"
                onClick={() => {
                  setShowUserMenu(false);
                  setShowAccountSettings(true);
                }}
                title="View your plan, call credits, AI tokens & account recovery"
              >
                Account &amp; plan details
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowUserMenu(false);
                  setShowPricing(true);
                }}
              >
                Upgrade / renew
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowUserMenu(false);
                  setShowFeedback(true);
                }}
              >
                Give feedback
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowUserMenu(false);
                  onSignOut();
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="tp-workspace" id="workspace-content">
        <header className="tp-welcome">
          <div>
            <span className="tp-eyebrow">YOUR NEXT CHAPTER</span>
            <h1>Welcome back, {user}.</h1>
            <p>{resume.trim() ? "Your experience is here. Let’s turn it into your next opportunity." : "A stronger application starts with your story. Let’s bring it together."}</p>
          </div>
          <div className="tp-welcome-orbit" aria-hidden="true"><Icon name="spark" size={34} /></div>
        </header>
        <section className="tp-live-notice" aria-labelledby="desktop-required-heading">
          <div className="tp-live-notice-heading">
            <span className="tp-live-notice-icon"><Icon name="shield" size={22} /></span>
            <h2 id="desktop-required-heading">Desktop Application Required For Live Calls</h2>
          </div>
          <p>
            Web browsers cannot reliably hide from screen sharing in Zoom, Google Meet, or Microsoft Teams.
            Live listening, AI transcription, and answer assistance run exclusively in the TechPrep Desktop App,
            with native screen-capture protection where supported. An active interview subscription is required
            to use live support. Visibility depends on your OS and sharing method. Test your setup first and
            obtain consent for audio capture.
          </p>
          <div className="tp-live-notice-actions">
            <div className="tp-live-plan-prompt">
              <strong>{callsExhausted ? "Renew to start another live call" : needsSubscription
                ? "Your interview subscription is inactive"
                : "Your interview subscription is active"}</strong>
              <span>{needsSubscription
                ? "Choose an interview plan, then continue in the desktop app."
                : "Use the desktop app for live calls, or manage your plan here."}</span>
            </div>
            <div className="tp-live-buttons">
              <button type="button" className="tp-btn tp-btn-amber" onClick={() => setShowPricing(true)}>
                {callsExhausted ? "Renew subscription" : needsSubscription ? "View subscription plans" : "Manage subscription"}
                <Icon name="arrow" size={16} />
              </button>
              <a className="tp-btn" href="#desktop-app"><Icon name="desktop" size={16} /> Get desktop app</a>
            </div>
          </div>
        </section>
        <nav className="tp-workflow-nav" aria-label="Quick actions">
          <a href="#ats-builder"><span className="tp-workflow-icon"><Icon name="file" size={21} /></span><span>ATS Resume Builder</span><Icon name="arrow" size={17} /></a>
          <a href="#job-search"><span className="tp-workflow-icon"><Icon name="search" size={21} /></span><span>Find jobs</span><Icon name="arrow" size={17} /></a>
          <button onClick={() => setShowMockInterview(true)}><span className="tp-workflow-icon"><Icon name="mic" size={21} /></span><span>Mock interview</span><Icon name="arrow" size={17} /></button>
          <a href="#desktop-app"><span className="tp-workflow-icon"><Icon name="desktop" size={21} /></span><span>Desktop app</span><Icon name="arrow" size={17} /></a>
        </nav>

        <div className="tp-content-grid">
          <section id="ats-builder" className="tp-panel">
            <div className="tp-panel-heading">
              <div className="tp-heading-label"><span className="tp-step-number">01</span><h2>Shape your next application</h2></div>
              <div className="tp-tag-row"><span className="tp-pill tp-pill-green">Free ATS score</span><span className="tp-pill tp-pill-violet">Resume unlock ₹10</span></div>
            </div>
            <p className="tp-panel-description">Bring your resume. Add a role you’re excited about. Get a clearer picture of your fit and what to improve.</p>
            <div className="tp-resume-grid">
              <div className="tp-field">
                <div className="tp-field-top">
                  <span>Your resume</span>
                  <small>{resume.trim() ? `${resume.trim().split(/\s+/).length} words` : "PDF required for ATS"}</small>
                </div>
                {!resume.trim() && !resumeUploaded && !pasteMode ? (
                  <ResumeUploadButton onExtracted={(text) => { setResume(text); setResumeUploaded(true); }}>
                    {(status, error, triggerUpload) => (
                      <button className="tp-upload-zone" type="button" onClick={triggerUpload} disabled={status === "extracting"}>
                        <Icon name="upload" size={26} />
                        <strong>{status === "extracting" ? "Reading your resume…" : "Choose your resume PDF"}</strong>
                        <small>One upload. A more personalized workspace.</small>
                        <span className="tp-pill tp-pill-violet">Browse files</span>
                      </button>
                    )}
                  </ResumeUploadButton>
                ) : (
                  pasteMode && !resumeUploaded ? (
                    <textarea
                      rows={6}
                      className="tp-textarea"
                      aria-label="Resume text"
                      placeholder="Paste resume text for job search..."
                      value={resume}
                      onChange={(e) => setResume(e.target.value)}
                    />
                  ) : (
                    <div className="tp-upload-zone" style={{ cursor: "default", alignItems: "flex-start", textAlign: "left" }}>
                      <Icon name="check" size={22} />
                      <strong>Resume uploaded successfully</strong>
                      <small>We’ll use your resume directly for ATS scoring and job search. Full text is hidden for cleaner view.</small>
                    </div>
                  )
                )}
                <div className="tp-file-status">
                  {resumeUploaded && <><Icon name="check" size={14} /> PDF ready for analysis</>}
                  {(resume.trim() || resumeUploaded) && (
                  <ResumeUploadButton
                    onExtracted={(text) => {
                      setResume(text);
                      setResumeUploaded(true);
                      setPasteMode(false);
                    }}
                    style={{ marginTop: 0 }}
                    label="Replace PDF"
                    buttonStyle={{ background: "transparent", color: "#c3b5ff", border: "none", padding: "4px 0", fontSize: 14 }}
                  />
                  )}
                  {pasteMode && !resumeUploaded && !resume.trim() && (
                    <button className="tp-btn tp-btn-text" style={{ padding: "4px 0", minHeight: 28, fontSize: 14 }}
                      onClick={() => setPasteMode(false)}>Upload PDF instead</button>
                  )}
                </div>
                <small className="tp-muted">Supported Formats: doc, docx, rtf, pdf, upto 2 MB</small>
                {!resume.trim() && !resumeUploaded && !pasteMode && (
                  <button className="tp-btn tp-btn-text" style={{ alignSelf: "start", padding: 0, minHeight: 28, fontSize: 14 }}
                    onClick={() => setPasteMode(true)}>Or paste resume text for job search</button>
                )}
              </div>
              <label className="tp-field">
                <div className="tp-field-top">
                  <span>The role you have in mind</span>
                  <small>Optional</small>
                </div>
                <textarea
                  rows={6}
                  className="tp-textarea"
                  placeholder="Paste a job description for a more focused ATS score and tailored suggestions…"
                  value={jd}
                  onChange={(e) => setJd(e.target.value)}
                />
                <small className="tp-muted">Skills, responsibilities, and role level help make a better match.</small>
              </label>
            </div>
            <div className="tp-panel-actions">
              <span><Icon name="shield" size={15} /> Free score. Full rebuild &amp; downloads: ₹10 / 24 hours.</span>
              <button
                type="button"
                className="tp-btn tp-btn-primary"
                onClick={() => setShowAtsScore(true)}
                disabled={!resume.trim() || !resumeUploaded}
              >
                Analyze my resume <Icon name="arrow" size={16} />
              </button>
            </div>
          </section>

          <section id="job-search">
            <JobSearchPanel resume={resume} jd={jd} user={user} />
          </section>

          {/* Desktop App Download + Interview History share a row to use up the leftover width */}
          <div id="desktop-app" className="tp-secondary-grid">
            <section className="tp-panel">
              <div className="tp-panel-heading">
                <div className="tp-heading-label"><span className="tp-step-number">03</span><h2>Your desktop companion</h2></div>
              </div>
              <p className="tp-panel-description">Keep your preparation close. Live audio and the overlay run in the desktop app.</p>
              <div className="tp-desktop-note"><Icon name="desktop" size={20} /><span>Use the same account on Windows or macOS. Screen-capture protection depends on your system and sharing setup.</span></div>
              <DesktopDownload localNetwork={localNetwork} storeUrl={storeUrl} />
              <div style={{ borderTop: "1px solid var(--tp-border)", marginTop: 20, paddingTop: 18 }}>
                <h3 style={{ fontSize: 13, margin: "0 0 12px", fontWeight: 600 }}>A quick start</h3>
                <ol style={{ paddingLeft: 18, margin: 0, color: "var(--tp-muted)", fontSize: 14, lineHeight: 2 }}>
                  <li>Download and install the app for your system.</li>
                  <li>Sign in with your TechPrep account.</li>
                  <li>Add your resume and job description in the app.</li>
                  <li>With participants’ consent, start listening.</li>
                </ol>
              </div>
              <p className="tp-shortcut-tip">Bring the app back into view with <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>T</kbd>.</p>
            </section>

            <section className="tp-panel">
              <div className="tp-panel-heading">
                <div className="tp-heading-label"><Icon name="history" /><h2>Keep building on your progress</h2></div>
              </div>
              <p className="tp-panel-description">Your questions and answers, ready when you are. Open your history to review past sessions, or practice something new.</p>
              <div className="tp-history-visual" aria-hidden="true"><i /><i /><i /><span>Reflect. Refine. Repeat.</span></div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="tp-btn" onClick={() => setShowHistory(true)}>Full View <Icon name="arrow" size={15} /></button>
                <button className="tp-btn tp-btn-text" onClick={() => setShowMockInterview(true)}><Icon name="mic" size={16} /> Start mock interview</button>
              </div>
            </section>
          </div>
        </div>
      </main>

      {showHistory && (
        <Dialog label="Interview History & Question Prep" onClose={() => setShowHistory(false)}>
            <InterviewHistory inModal={true} onClose={() => setShowHistory(false)} />
        </Dialog>
      )}

      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}

      {showMockInterview && <MockInterview onClose={() => setShowMockInterview(false)} />}

      {showAtsScore && (
        <AtsScorePanel
          resume={resume}
          jd={jd}
          uploadedResume={resumeUploaded}
          requireUploadedResume={true}
          onClose={() => setShowAtsScore(false)}
        />
      )}

      {showAccountSettings && (
        <Dialog label="Account and plan details" onClose={() => setShowAccountSettings(false)}>
            <div style={styles.cardHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <h2 style={styles.cardTitle}>Account &amp; plan</h2>
                <span style={hasActiveSub && !callsExhausted ? styles.activeBadge : styles.inactiveBadge}>
                  {callsExhausted ? "Calls Used" : hasActiveSub ? "Active Member" : "Action Required"}
                </span>
                <span style={{ fontSize: 13, color: "#94a3b8" }}>({user})</span>
              </div>
              <button className="tp-btn" aria-label="Close account details" onClick={() => setShowAccountSettings(false)}><Icon name="close" size={18} /></button>
            </div>

            <div style={styles.accountModalBody}>
              {/* Subscription & Credits */}
              <section style={styles.innerAccountCard}>
                <div style={styles.cardHeader}>
                  <h3 style={styles.innerSectionTitle}>Subscription &amp; credits</h3>
                  <button className="tp-btn" onClick={() => setShowPricing(true)}>
                    Upgrade / Renew
                  </button>
                </div>

                {hasActiveSub ? (
                  <div style={styles.subActiveContent}>
                    <div style={styles.subPlanRow}>
                      <div>
                        <div style={styles.subPlanName}>{subscription.plan_name}</div>
                        <div style={styles.subPlanMeta}>Amount: ₹{subscription.amount}</div>
                      </div>
                    </div>

                    {lowCalls && (
                      <div role="status" style={styles.lowCallsNotice}>
                        ⚠️ <strong>Only {lowCalls.remaining} of {lowCalls.total} calls left.</strong> Renew soon so your next interview is not interrupted.
                        <button style={styles.actionBtn} onClick={() => setShowPricing(true)}>Renew now</button>
                      </div>
                    )}

                    <div style={styles.detailBox}>
                      <div style={styles.detailItem}>
                        <span style={styles.detailLabel}>Session Validity</span>
                        <strong style={styles.detailValue}>
                          {subscription.plan_id === "monthly"
                            ? `${Math.ceil(subscription.time_remaining_seconds / 86400)} days remaining`
                            : timeLeftMinutes !== null ? `${timeLeftMinutes} mins remaining` : "Starts on first use"}
                        </strong>
                      </div>
                      <div style={styles.detailItem}>
                        <span style={styles.detailLabel}>Calls remaining</span>
                        <strong style={styles.detailValue}>
                          {subscription.calls_total === null ? "Unlimited (existing plan)"
                            : subscription.calls_remaining === 0 && subscription.call_time_remaining_seconds > 0
                              ? "In progress (current session)"
                              : subscription.calls_remaining === 0
                                ? "Used — renew to continue"
                                : `${subscription.calls_remaining} of ${subscription.calls_total}`}
                        </strong>
                      </div>
                      <div style={styles.detailItem}>
                        <span style={styles.detailLabel}>Real-Time LLM Answers</span>
                        <strong style={{ ...styles.detailValue, color: "#4ade80" }}>✓ Unlocked</strong>
                      </div>
                      <div style={styles.detailItem}>
                        <span style={styles.detailLabel}>Capture protection</span>
                        <strong style={styles.detailValue}>Desktop, where supported</strong>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={styles.subInactiveContent}>
                    <p style={styles.inactiveText}>
                      You do not have an active session plan. View the current call and monthly plans to start.
                    </p>
                    <button style={styles.primaryBtn} onClick={() => setShowPricing(true)}>
                      View Plans →
                    </button>
                  </div>
                )}
              </section>

              {/* AI Token Usage */}
              <section style={styles.innerAccountCard}>
                <div style={styles.cardHeader}>
                  <h3 style={styles.innerSectionTitle}>AI Token Usage</h3>
                </div>
                {tokenUsage ? (
                  <div style={styles.detailBox}>
                    <div style={styles.detailItem}>
                      <span style={styles.detailLabel}>Tokens burned</span>
                      <strong style={styles.detailValue}>{tokenUsage.total_tokens.toLocaleString()}</strong>
                    </div>
                    <div style={styles.detailItem}>
                      <span style={styles.detailLabel}>Input / Output</span>
                      <strong style={styles.detailValue}>
                        {tokenUsage.prompt_tokens.toLocaleString()} / {tokenUsage.completion_tokens.toLocaleString()}
                      </strong>
                    </div>
                    <div style={styles.detailItem}>
                      <span style={styles.detailLabel}>Tokens remaining</span>
                      <strong style={styles.detailValue}>No token cap — limited by call-hours</strong>
                    </div>
                    <p style={{ color: "#94a3b8", fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                      Recorded AI tokens since tracking began. Audio transcription is not token-billed.
                      Only provider-reported token usage is counted.
                    </p>
                  </div>
                ) : <p style={{ color: "#fca5a5", fontSize: 13 }} role="alert">Token usage unavailable. Refresh to try again.</p>}
              </section>

              {/* Account Recovery */}
              {passwordResetEnabled && !isAdmin && (
                <section style={styles.innerAccountCard}>
                  <div style={styles.cardHeader}>
                    <h3 style={styles.innerSectionTitle}>Account Recovery</h3>
                  </div>
                  <RecoveryEmail />
                </section>
              )}

              {isAdmin && <AdminPlans />}
              {isAdmin && <AdminFeedback />}
            </div>
        </Dialog>
      )}

      {showPricing && (
        <SubscriptionPricing
          currentSubscription={subscription}
          allowQrUpload={isAdmin}
          onClose={() => setShowPricing(false)}
          onPaymentSuccess={() => {
            setShowPricing(false);
            if (onRefreshSubscription) onRefreshSubscription();
          }}
        />
      )}
    </div>
  );
}

const styles = {
  lowCallsNotice: {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
    padding: "10px 14px", borderRadius: 10, fontSize: 13, color: "#fde68a",
    background: "rgba(245, 158, 11, 0.12)", border: "1px solid rgba(251, 191, 36, 0.5)",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 700,
    margin: 0,
  },
  activeBadge: {
    background: "rgba(74, 222, 128, 0.15)",
    color: "#86efac",
    border: "1px solid rgba(74, 222, 128, 0.3)",
    fontSize: 11,
    padding: "3px 8px",
    borderRadius: 9999,
    fontWeight: 700,
  },
  inactiveBadge: {
    background: "rgba(248, 113, 113, 0.15)",
    color: "#fca5a5",
    border: "1px solid rgba(248, 113, 113, 0.3)",
    fontSize: 11,
    padding: "3px 8px",
    borderRadius: 9999,
    fontWeight: 700,
  },
  subActiveContent: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  subPlanRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 16px",
    borderRadius: 12,
    background: "rgba(255, 255, 255, 0.03)",
    border: "1px solid rgba(255, 255, 255, 0.06)",
  },
  subPlanName: {
    fontSize: 16,
    fontWeight: 700,
    color: "#b3a3fa",
  },
  subPlanMeta: {
    fontSize: 12,
    color: "#aaa4bc",
    marginTop: 2,
  },
  actionBtn: {
    background: "rgba(56, 189, 248, 0.15)",
    border: "1px solid rgba(56, 189, 248, 0.3)",
    color: "#b3a3fa",
    padding: "8px 14px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  detailBox: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    background: "rgba(0, 0, 0, 0.2)",
    padding: 14,
    borderRadius: 10,
  },
  detailItem: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    fontSize: 13,
  },
  detailLabel: {
    color: "#aaa4bc",
  },
  detailValue: {
    fontWeight: 600,
    textAlign: "right",
  },
  subInactiveContent: {
    textAlign: "center",
    padding: "16px 0",
  },
  inactiveText: {
    color: "#aaa4bc",
    fontSize: 13,
    lineHeight: 1.5,
    margin: "0 0 16px",
  },
  primaryBtn: {
    width: "100%",
    background: "#7058db",
    color: "#ffffff",
    border: "none",
    padding: "12px 18px",
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 6px 20px rgba(56, 189, 248, 0.35)",
  },
  accountModalBody: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
    marginTop: 16,
  },
  innerAccountCard: {
    background: "#1b1923",
    border: "1px solid #302c3c",
    borderRadius: 14,
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  innerSectionTitle: {
    fontSize: 16,
    fontWeight: 700,
    margin: 0,
  },
};
