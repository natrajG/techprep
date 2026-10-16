import { useEffect, useState } from "react";
import App from "./App";
import Landing from "./Landing";
import Login from "./Login";
import SubscriptionPricing from "./SubscriptionPricing";
import { checkSession, clearToken, loadConfig, login, signup } from "./auth.mjs";
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
  const [subscription, setSubscription] = useState(null);
  const [reload, setReload] = useState(0);
  const [authView, setAuthView] = useState(null); // null | 'signin' | 'signup'
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
          try {
            const subData = await fetchSubscriptionStatus(API);
            if (!active) return;
            if (subData.has_active && subData.subscription) {
              setSubscription(subData.subscription);
            } else {
              setSubscription(null);
              // Auto show subscription pricing for newly signed-in users without active plan on web
              if (!desktop && !renewRequested) {
                setShowRenewModal(true);
              }
            }
          } catch {
            if (!active) return;
            setSubscription(null);
          }
          setSession("signedIn");
        } else {
          setCurrentUser(null);
          setSubscription(null);
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
    setSession("signedIn");
  }

  async function signUp(username, password) {
    await signup(API, username, password);
    setSession("signedIn");
  }

  function signOut() {
    clearToken();
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
    if (!desktop && !authView) {
      return (
        <Landing
          onSignIn={() => setAuthView("signin")}
          onSignUp={() => setAuthView("signup")}
          storeUrl={config.store_url}
        />
      );
    }
    return (
      <>
        {showRenewModal && (
          <SubscriptionPricing
            onClose={() => setShowRenewModal(false)}
            onPaymentSuccess={() => {
              setShowRenewModal(false);
              setAuthView("signin");
            }}
          />
        )}
        {(loginWindow || !desktop) && (
          <Login
            initialMode={loginWindow ? "signin" : (authView || "signin")}
            onSubmit={signIn}
            onSignUp={loginWindow ? undefined : (config.signup_enabled ? signUp : undefined)}
            onBack={desktop ? undefined : () => setAuthView(null)}
            minimumPassword={config.minimum_password}
          />
        )}
      </>
    );
  }
  if (loginWindow) return <p style={{ fontFamily: "system-ui", padding: 16 }}>Opening the overlay…</p>;
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
        initialSubscription={subscription}
        localNetwork={config.local_network}
        storeUrl={config.store_url}
      />
    </>
  );
}
