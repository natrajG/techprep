import { useEffect, useState } from "react";
import App from "./App";
import Landing from "./Landing";
import Login from "./Login";
import SubscriptionPricing from "./SubscriptionPricing";
import SupportChatbot from "./SupportChatbot";
import WebDashboard from "./WebDashboard";
import AdminDashboard from "./AdminDashboard";
import {
  checkSession, clearToken, loadConfig, login, readResetToken, requestPasswordReset, resetPassword, signup,
} from "./auth.mjs";
import { fetchSubscriptionStatus } from "./subscriptions.mjs";

const desktop = window.desktop;
const API = import.meta.env.VITE_API_URL || "";
// In Electron, the first window is a login window (?login=1); the overlay opens only after sign-in.
const searchParams = new URLSearchParams(location.search);
const loginWindow = !!desktop && searchParams.has("login");
const renewRequested = searchParams.has("renew");

export default function Root() {
  const [session, setSession] = useState("checking"); // checking | signedOut | signedIn | unreachable
  const [currentUser, setCurrentUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [subscription, setSubscription] = useState(null);
  const [tokenUsage, setTokenUsage] = useState(null);
  const [reload, setReload] = useState(0);
  const [resetToken, setResetToken] = useState(() => readResetToken(location.hash));
  const [authView, setAuthView] = useState(resetToken ? "signin" : null); // null | 'signin' | 'signup'
  const [config, setConfig] = useState(null);
  const [showRenewModal, setShowRenewModal] = useState(renewRequested);

  useEffect(() => {
    let active = true;
    setSession("checking");
    Promise.all([checkSession(API), loadConfig(API)])
      .then(async ([sessionResult, loaded]) => {
        if (!active) return;
        setConfig(loaded);
        if (sessionResult.ok) {
          setCurrentUser(sessionResult.user);
          setIsAdmin(sessionResult.isAdmin);
          try {
            const subData = await fetchSubscriptionStatus(API);
            if (!active) return;
            setTokenUsage(subData.token_usage);
            if (subData.has_active && subData.subscription) {
              setSubscription(subData.subscription);
            } else {
              setSubscription(null);
              // Auto show subscription pricing for newly signed-in users without active plan on web
              if (!desktop && !renewRequested && !sessionResult.isAdmin) {
                setShowRenewModal(true);
              }
            }
          } catch {
            if (!active) return;
            setSubscription(null);
            setTokenUsage(null);
          }
          setSession("signedIn");
        } else {
          setCurrentUser(null);
          setIsAdmin(false);
          setSubscription(null);
          setTokenUsage(null);
          setSession("signedOut");
        }
      })
      .catch(() => active && setSession("unreachable"));
    return () => { active = false; };
  }, [reload]);

  useEffect(() => {
    const expire = () => setSession("signedOut");
    window.addEventListener("auth-expired", expire);
    return () => window.removeEventListener("auth-expired", expire);
  }, []);

  // The overlay must never stay open without a session.
  useEffect(() => {
    if (!desktop) return;
    if (session === "signedIn" && loginWindow) desktop.loginSucceeded();
    if (session === "signedOut" && !loginWindow) desktop.signOut();
  }, [session]);

  async function signIn(username, password) {
    await login(API, username, password);
    setAuthView(null);
    setReload((value) => value + 1);
  }

  async function signUp(username, password, email) {
    await signup(API, username, password, email);
    setAuthView(null);
    setReload((value) => value + 1);
  }

  function finishReset() {
    history.replaceState(null, "", location.pathname + location.search);
    setResetToken(null);
  }

  const passwordReset = config?.password_reset_enabled ? {
    onForgot: (email) => requestPasswordReset(API, email),
    onReset: (token, password) => resetPassword(API, token, password),
    onResetDone: finishReset,
    resetToken,
  } : {};

  function signOut() {
    clearToken();
    setAuthView(null);
    setShowRenewModal(false);
    setCurrentUser(null);
    setIsAdmin(false);
    setSubscription(null);
    setTokenUsage(null);
    if (desktop) desktop.signOut();
    else setSession("signedOut");
  }

  if (session === "checking") return <p style={{ fontFamily: "system-ui", padding: 16 }}>Loading…</p>;
  if (session === "unreachable") {
    return (
      <main style={{ fontFamily: "system-ui", padding: 16 }}>
        <p>Cannot reach the backend. Start it and retry.</p>
        <button onClick={() => setReload((n) => n + 1)}>Retry</button>
      </main>
    );
  }
  if (session === "signedOut") {
    if (!desktop) {
      return (
        <>
          <Landing
            onSignIn={() => setAuthView("signin")}
            onSignUp={() => setAuthView("signup")}
            storeUrl={config?.store_url}
          />
          {authView && (
            <Login
              initialMode={authView}
              onSubmit={signIn}
              onSignUp={config?.signup_enabled ? signUp : undefined}
              onBack={() => setAuthView(null)}
              minimumPassword={config?.minimum_password || 8}
              isModal={true}
              {...passwordReset}
            />
          )}
          {showRenewModal && (
            <SubscriptionPricing
              onClose={() => setShowRenewModal(false)}
              onPaymentSuccess={() => {
                setShowRenewModal(false);
                setAuthView("signin");
              }}
            />
          )}
          <SupportChatbot />
        </>
      );
    }
    return (
      <Login
        initialMode="signin"
        onSubmit={signIn}
        onSignUp={undefined}
        wrongPasswordHint="Forgot it? Reset your password on the website."
        minimumPassword={config?.minimum_password || 8}
      />
    );
  }
  if (loginWindow) return <p style={{ fontFamily: "system-ui", padding: 16 }}>Opening the overlay…</p>;

  // Web browser users: render the Web Dashboard (subscription management, desktop download, instructions)
  // Live listening and HUD overlay are exclusively reserved for the desktop application.
  if (!desktop) {
    if (isAdmin) {
      return (
        <AdminDashboard
          user={currentUser}
          onSignOut={signOut}
        />
      );
    }
    return (
      <>
        {showRenewModal && (
          <SubscriptionPricing
            currentSubscription={subscription}
            onClose={() => setShowRenewModal(false)}
            onPaymentSuccess={() => {
              setShowRenewModal(false);
              setReload((n) => n + 1);
            }}
          />
        )}
        <WebDashboard
          user={currentUser}
          isAdmin={false}
          subscription={subscription}
          tokenUsage={tokenUsage}
          onSignOut={signOut}
          storeUrl={config?.store_url}
          passwordResetEnabled={config?.password_reset_enabled}
          localNetwork={config?.local_network}
          onRefreshSubscription={() => setReload((n) => n + 1)}
        />
        <SupportChatbot />
      </>
    );
  }

  // Desktop Electron application: render the stealth HUD overlay
  return (
    <>
      {showRenewModal && (
        <SubscriptionPricing
          currentSubscription={subscription}
          onClose={() => setShowRenewModal(false)}
          onPaymentSuccess={() => {
            setShowRenewModal(false);
            setReload((n) => n + 1);
          }}
        />
      )}
      <App
        onSignOut={signOut}
        currentUser={currentUser}
        isAdmin={isAdmin}
        initialSubscription={subscription}
        localNetwork={config.local_network}
        storeUrl={config.store_url}
      />
    </>
  );
}
