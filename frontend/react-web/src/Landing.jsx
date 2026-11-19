import { useEffect, useState } from "react";
import InteractiveDemo from "./InteractiveDemo";
import Icon from "./Icon";
import BrandMark from "./BrandMark";
import { fetchPlans } from "./subscriptions.mjs";
import { fetchRatingSummary } from "./ratings.mjs";

const API = import.meta.env.VITE_API_URL || "";
const tools = [
  { id: "resume", icon: "file", title: "ATS Resume Builder", text: "Turn your experience into a role-ready resume. Check your ATS match, find missing keywords, and rebuild with AI.", tag: "Free ATS score · Full resume unlock ₹10", action: "Build my resume" },
  { id: "practice", icon: "mic", title: "Mock Interviews", text: "Find the words before the real conversation. Practice role-specific questions and get feedback on your delivery.", tag: "Read-aloud coaching · Personalized questions", action: "Start practicing" },
  { id: "jobs", icon: "search", title: "Resume-Based Job Search", text: "Let your experience guide the search. Discover relevant roles, shortlist your favorites, and open their application pages.", tag: "Jooble", action: "Find my next role" },
];
const previewModes = [
  { id: "answers", label: "Live answers", icon: "spark" },
  { id: "context", label: "Resume context", icon: "file" },
  { id: "protection", label: "Capture protection", icon: "shield" },
];
const faqs = [
  ["What can I do in the browser?", "Build and score your resume, explore relevant jobs, practice mock interviews, and manage your account. Live audio transcription and the always-on-top HUD run in the desktop app."],
  ["Is the resume builder free?", "ATS scoring and the rebuild preview are free. The full AI-rebuilt resume and PDF/DOCX downloads cost ₹10, with 24-hour access. This is separate from interview subscriptions."],
  ["Is the HUD invisible in every screen share?", "No universal guarantee is possible. TechPrep uses native capture protection where supported. Visibility depends on your operating system, meeting app, and sharing method. Test your setup first, obtain consent for audio capture, and follow your interviewer’s rules."],
  ["Does job search automatically apply for me?", "No. You can select matching jobs and open their application pages together. You review and submit each application on the employer’s or provider’s website. Your browser may ask you to allow multiple tabs."],
];
const steps = [
  ["Bring your experience", "Upload your resume and add a job description for more relevant guidance."],
  ["Find your direction", "Check your ATS match and explore roles based on your skills."],
  ["Prepare your answers", "Practice with mock interviews and revisit your question history."],
  ["Show up ready", "Use the desktop companion for supported, consent-based interview assistance."],
];

export default function Landing({ onSignIn, onSignUp, storeUrl }) {
  const [plans, setPlans] = useState([]);
  const [planError, setPlanError] = useState("");
  const [plansLoading, setPlansLoading] = useState(true);
  const [rating, setRating] = useState(null);
  const [showDemo, setShowDemo] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState("answers");
  useEffect(() => {
    let active = true;
    fetchPlans(API).then((data) => { if (active) setPlans(data.plans || []); })
      .catch((e) => { if (active) setPlanError(e.message); })
      .finally(() => { if (active) setPlansLoading(false); });
    fetchRatingSummary(API).then((data) => { if (active) setRating(data); })
      .catch((e) => console.warn("Rating summary unavailable:", e.message));
    return () => { active = false; };
  }, []);
  const hourly = plans.find((p) => p.id === "hourly_call");
  const monthly = plans.find((p) => p.id === "monthly");
  const getStarted = onSignUp || onSignIn;

  return (
    <div className="tp-landing">
      <a className="tp-skip" href="#main-content">Skip to content</a>
      <header className="tp-public-nav">
        <div className="tp-wrap tp-nav-inner">
          <a className="tp-brand" href="#" aria-label="TechPrep home">
            <BrandMark />TechPrep
          </a>
          <nav className={`tp-nav-links ${menuOpen ? "open" : ""}`} id="public-navigation" aria-label="Main navigation"
            onClick={() => setMenuOpen(false)}>
            <a href="#interview-hud">Interview HUD</a>
            <a href="#features">Career toolkit</a>
            <a href="#how-it-works">How it works</a>
            <a href="#pricing">Pricing</a>
            <a className="tp-mobile-signin" href="#signin" onClick={(event) => { event.preventDefault(); onSignIn(); }}>Sign in</a>
          </nav>
          <div className="tp-nav-account">
            <button className="tp-btn tp-btn-text" onClick={onSignIn}>Sign in</button>
            <button className="tp-btn tp-btn-primary" onClick={getStarted}>Get started <Icon name="arrow" size={15} /></button>
          </div>
          <button className="tp-btn tp-nav-toggle" onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="public-navigation">
            <Icon name={menuOpen ? "close" : "menu"} />
          </button>
        </div>
      </header>

      <main id="main-content">
        <section className="tp-spotlight">
          <div className="tp-aurora" aria-hidden="true" />
          <div className="tp-wrap tp-spotlight-inner">
            <div className="tp-hero-orbit tp-orbit-left" aria-hidden="true"><Icon name="mic" size={22} /><span>Hear it.<br /><strong>Understand it.</strong></span></div>
            <div className="tp-hero-orbit tp-orbit-right" aria-hidden="true"><Icon name="spark" size={22} /><span>Your experience.<br /><strong>Sharper answers.</strong></span></div>
            <span className="tp-launch-badge"><span aria-hidden="true">✨</span> NEXT-GEN STEALTH INTERVIEW INTELLIGENCE</span>
            <h1>Crack Every Tech Interview<br /><span>with <em>Invisible AI HUD</em></span></h1>
            <p className="tp-spotlight-description">Real-time audio transcription and instant, resume-tailored answers delivered through a discreet, always-on-top glass overlay. Built for your Zoom, Teams &amp; Google Meet conversations.</p>
            <p className="tp-capture-note"><Icon name="shield" size={14} /> Hidden from screen sharing on supported setups. Protection varies by OS and sharing method.</p>
            <div className="tp-hero-actions tp-spotlight-actions">
              <button className="tp-btn tp-btn-primary" onClick={getStarted}>Get interview-ready <Icon name="arrow" size={17} /></button>
              <button className="tp-btn" onClick={() => setShowDemo(true)}><Icon name="play" size={15} /> Explore the demo</button>
            </div>
            <span className="tp-hero-note"><Icon name="check" size={14} /> Free ATS scoring <span aria-hidden="true">·</span> Windows &amp; macOS <span aria-hidden="true">·</span> Your complete career toolkit</span>
            <div className="tp-trust-strip" aria-label="Community ratings">
              <div className="tp-trust-people"><span className="tp-trust-icon"><Icon name="check" size={18} /></span><span>Trusted by <strong>1 Lakh+ people</strong></span></div>
              <span className="tp-trust-divider" aria-hidden="true" />
              <div className="tp-trust-rating"><span className="tp-trust-stars" aria-label="4.2 out of 5 stars">★★★★★</span><strong>4.2/5</strong><span>from 10K+ reviews</span></div>
            </div>

            <div className="tp-hud-stage" id="interview-hud" role="region" aria-label="Illustrative preview of the interview workspace">
              <div className="tp-stage-toolbar">
                <span className="tp-stage-brand"><BrandMark className="tp-stage-mark" /> TechPrep <span>DESKTOP COMPANION</span></span>
                <span className="tp-pill"><span className="tp-dot" /> Illustrative demo</span>
              </div>
              <div className="tp-stage-body">
                <div className="tp-meeting-preview">
                  <div className="tp-meeting-heading"><span>Technical interview</span><span className="tp-pill">Sample session</span></div>
                  <div className="tp-meeting-people" aria-hidden="true">
                    <div className="tp-person tp-person-interviewer"><div className="tp-person-silhouette" /><span>Interviewer <Icon name="mic" size={12} /></span></div>
                    <div className="tp-person tp-person-you"><div className="tp-person-silhouette" /><span>You <Icon name="mic" size={12} /></span></div>
                  </div>
                  <div className="tp-transcript"><div className="tp-audio-wave" aria-hidden="true">{Array.from({ length: 15 }, (_, index) => <i key={index} />)}</div><span>“How would you design a scalable API?”</span></div>
                  <div className="tp-meeting-bottom"><span>Stay in the conversation.</span><span className="tp-meeting-controls" aria-hidden="true"><Icon name="mic" size={15} /><Icon name="desktop" size={15} /><span className="tp-end-call" /></span></div>
                </div>
                <div className="tp-glass-hud">
                  <div className="tp-glass-top"><span><Icon name="spark" size={17} /> Your AI advantage</span><span className="tp-context-chip"><Icon name="file" size={12} /> Resume-aware</span></div>
                  <div className="tp-preview-modes" role="group" aria-label="HUD preview mode">
                    {previewModes.map((mode) => <button key={mode.id} aria-pressed={previewMode === mode.id} onClick={() => setPreviewMode(mode.id)}><Icon name={mode.icon} size={14} />{mode.label}</button>)}
                  </div>
                  <div className="tp-hud-content" aria-live="polite" aria-atomic="true">
                    {previewMode === "answers" && <>
                      <span className="tp-eyebrow">A STRUCTURED STARTING POINT</span>
                      <h2>Turn a tough question<br />into a clear answer.</h2>
                      <p><b>Start with the requirements.</b> Clarify traffic, latency targets, and consistency needs.</p>
                      <p><b>Build for growth.</b> Use stateless services, a load balancer, caching, and a durable queue for background work.</p>
                      <div className="tp-hud-insight"><Icon name="spark" size={15} /><span>Connect this to a scaling challenge from your own experience.</span></div>
                    </>}
                    {previewMode === "context" && <>
                      <span className="tp-eyebrow">YOUR STORY, NOT A GENERIC SCRIPT</span>
                      <h2>Answers grounded<br />in your experience.</h2>
                      <p>Add your resume and the target job description in the desktop app. Get suggestions shaped around your skills, projects, and the role.</p>
                      <div className="tp-context-skills"><span>Experience</span><span>Projects</span><span>Target role</span></div>
                      <div className="tp-hud-insight"><Icon name="file" size={15} /><span>Review every suggestion. Keep your answers accurate and your own.</span></div>
                    </>}
                    {previewMode === "protection" && <>
                      <span className="tp-eyebrow">A DISCREET DESKTOP WORKSPACE</span>
                      <h2>In your view.<br />Out of the way.</h2>
                      <p>A compact, always-on-top overlay with adjustable opacity and native screen-capture protection where supported.</p>
                      <div className="tp-hud-insight"><Icon name="shield" size={15} /><span>Test your OS and sharing setup first. Capture protection is not a universal invisibility guarantee.</span></div>
                    </>}
                  </div>
                  <div className="tp-glass-footer"><span><span className="tp-dot" /> Real-time assistance</span><span>Always-on-top glass HUD</span></div>
                </div>
              </div>
              <div className="tp-stage-caption"><span><Icon name="mic" size={15} /> Hear the question</span><Icon name="arrow" size={14} /><span><Icon name="file" size={15} /> Add your context</span><Icon name="arrow" size={14} /><span><Icon name="spark" size={15} /> Shape your answer</span></div>
            </div>
          </div>
        </section>

        <div className="tp-wrap">
          <div className="tp-capabilities">
            <span className="tp-compatible-label">FOR THE WAY YOU INTERVIEW</span>
            <span><span className="tp-platform-glyph tp-platform-zoom" aria-hidden="true">Z</span> Zoom</span>
            <span><span className="tp-platform-glyph tp-platform-teams" aria-hidden="true">T</span> Microsoft Teams</span>
            <span><span className="tp-platform-glyph tp-platform-meet" aria-hidden="true">M</span> Google Meet</span>
            <span><Icon name="desktop" size={18} /> Windows &amp; macOS</span>
          </div>
          <section className="tp-features" id="features">
            <div className="tp-section-head tp-centered-heading">
              <div><span className="tp-eyebrow">THE TECHPREP DIFFERENCE</span><h2>Not just interview answers.<br /><em>Your entire next chapter.</em></h2></div>
              <p>A stronger resume. More relevant opportunities. Better practice. Everything around your interview, connected in one workspace.</p>
            </div>
            <div className="tp-tool-grid">{tools.map((tool) => (
              <article className={`tp-tool-card tp-tool-${tool.id}`} key={tool.id}>
                <div className="tp-tool-art" role="img" aria-label={`${tool.title} illustrative preview`}>
                  {tool.id === "resume" && <><div className="tp-resume-paper"><span className="tp-paper-heading">YOUR NEXT CHAPTER</span><strong>A resume with direction.</strong><span className="tp-paper-rule" /><div className="tp-paper-lines"><i /><i /><i /></div><span className="tp-paper-heading">EXPERIENCE &amp; IMPACT</span><div className="tp-paper-lines"><i /><i /></div></div><span className="tp-art-callout"><Icon name="check" size={14} /> Make your experience count</span></>}
                  {tool.id === "practice" && <div className="tp-practice-art"><span className="tp-art-label">SAMPLE PRACTICE</span><span className="tp-practice-mic"><Icon name="mic" size={27} /></span><div className="tp-audio-wave" aria-hidden="true">{Array.from({ length: 23 }, (_, index) => <i key={index} />)}</div><span>Clarity. Confidence. Your own words.</span></div>}
                  {tool.id === "jobs" && <div className="tp-jobs-art"><span className="tp-art-label">ILLUSTRATIVE ROLES</span>{["Backend Engineer", "Data Engineer"].map((role, index) => <div className="tp-mini-job" key={role}><span className="tp-mini-job-icon"><Icon name={index ? "chart" : "briefcase"} size={20} /></span><div><strong>{role}</strong><span>Explore your next opportunity</span></div><Icon name="arrow" size={14} /></div>)}<span className="tp-job-art-note"><Icon name="search" size={13} /> Your resume sets the direction</span></div>}
                </div>
                <div className="tp-tool-copy"><span className="tp-feature-icon"><Icon name={tool.icon} size={20} /></span><h3>{tool.title}</h3><p>{tool.text}</p><span className="tp-feature-tag">{tool.tag}</span><button className="tp-tool-action" onClick={getStarted}>{tool.action}<Icon name="arrow" size={16} /></button></div>
              </article>
            ))}</div>
            <div className="tp-extra-features"><span><Icon name="history" size={19} /><strong>Keep your question history</strong>Return to what you learned.</span><span><Icon name="file" size={19} /><strong>Stay resume-aware</strong>Your background, not a generic script.</span><span><Icon name="shield" size={19} /><strong>Pay with confidence</strong>Verified Razorpay checkout.</span></div>
          </section>
          <section className="tp-how" id="how-it-works">
            <div className="tp-section-head"><div><span className="tp-eyebrow">A LITTLE STRUCTURE GOES A LONG WAY</span><h2>One next step at a time.</h2></div></div>
            <div className="tp-step-grid">{steps.map(([title, text], index) => (
              <article className="tp-step" key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{text}</p></article>
            ))}</div>
            <p className="tp-price-note">Job applications open on the employer’s website. You review and submit each application yourself.</p>
          </section>
        </div>

        <section className="tp-public-pricing" id="pricing">
          <div className="tp-wrap">
            <div className="tp-section-head"><div><span className="tp-eyebrow">CHOOSE YOUR PACE</span><h2>A clear next step.<br />A clear price.</h2></div><p>Start with your resume. Add interview assistance when you need it.</p></div>
            {planError && <p role="alert" className="tp-pricing-notice">Plans couldn’t load: {planError} Refresh the page to try again.</p>}
            {plansLoading && <p role="status" className="tp-price-note">Loading current plan prices…</p>}
            {!plansLoading && !planError && plans.length === 0 && <p role="status" className="tp-price-note">Interview plans are currently unavailable. Free ATS scoring is still available.</p>}
            <div className="tp-price-grid">
              <article className="tp-price-card"><span className="tp-eyebrow">START HERE</span><h3>ATS resume score</h3><div className="tp-price">Free</div><p>Check your resume against a job description. Unlock the full AI rebuild and PDF/DOCX downloads for ₹10, with 24-hour access.</p><button className="tp-btn" onClick={getStarted}>Check my resume <Icon name="arrow" size={16} /></button></article>
              <article className="tp-price-card featured"><span className="tp-eyebrow">ONE INTERVIEW AT A TIME</span><h3>{hourly?.name || "Single call"}</h3><div className="tp-price">{hourly ? `₹${hourly.amount.toLocaleString("en-IN")}` : "—"} <small>/ call</small></div><p>{hourly ? `${hourly.duration_minutes} minutes` : "A focused session"} of real-time assistance. Resume-aware answers, live transcription, and reconnect protection within your call window.</p><button className="tp-btn tp-btn-primary" onClick={getStarted}>Prepare for my interview <Icon name="arrow" size={16} /></button></article>
              <article className="tp-price-card"><span className="tp-eyebrow">ROOM TO BUILD MOMENTUM</span><h3>{monthly?.name || "Monthly plan"}</h3><div className="tp-price">{monthly ? `₹${monthly.amount.toLocaleString("en-IN")}` : "—"} <small>/ month</small></div><p>{monthly ? `${monthly.call_limit} one-hour calls over ${monthly.duration_days} days.` : "Multiple sessions in one plan."} More room for mock interviews, role-specific practice, and your interview schedule.</p><button className="tp-btn" onClick={getStarted}>Choose my plan <Icon name="arrow" size={16} /></button></article>
            </div>
            <p className="tp-price-note">Any payment gateway fee is shown before you pay. Resume downloads are a separate ₹10 purchase.</p>
            {rating?.count > 0 && <p className="tp-price-note">Rated {rating.average.toFixed(1)} / 5 by {rating.count} {rating.count === 1 ? "user" : "users"}</p>}
          </div>
        </section>
        <section className="tp-wrap tp-faq-section">
          <div className="tp-section-head"><div><span className="tp-eyebrow">A LITTLE MORE CLARITY</span><h2>Good questions.<br />Straight answers.</h2></div><p>Know what’s included, how it works, and where to begin.</p></div>
          <div className="tp-faq-list">{faqs.map(([question, answer]) => <details key={question}><summary>{question}<Icon name="chevron" size={18} /></summary><p>{answer}</p></details>)}</div>
        </section>
      </main>
      <footer className="tp-wrap tp-footer">
        <div className="tp-footer-row"><span className="tp-brand"><BrandMark />TechPrep</span><nav aria-label="Footer"><a href="/privacy/">Privacy policy</a></nav></div>
        <p>Prepare thoughtfully. Capture audio only with participants’ consent and follow your interviewer’s rules. Screen-capture protection varies by operating system and sharing method.</p>
      </footer>
      {showDemo && <InteractiveDemo onClose={() => setShowDemo(false)} onGoToPricing={() => { setShowDemo(false); document.getElementById("pricing")?.scrollIntoView(); }} />}
    </div>
  );
}
