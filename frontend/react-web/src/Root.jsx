import { useEffect, useState } from "react";
import App from "./App";
import Landing from "./Landing";
import Login from "./Login";
import { checkSession, clearToken, loadConfig, login, signup } from "./auth.mjs";

const desktop = window.desktop;
const API = import.meta.env.VITE_API_URL || "";
// In Electron, the first window is a login window (?login=1); the overlay opens only after sign-in.
const loginWindow = !!desktop && new URLSearchParams(location.search).has("login");

export default function Root() {
  const [session, setSession] = useState("checking"); // checking | signedOut | signedIn | unreachable
  const [reload, setReload] = useState(0);
  const [showLogin, setShowLogin] = useState(false);
  const [config, setConfig] = useState(null);

  useEffect(() => {
    let active = true;
    setSession("checking");
    Promise.all([checkSession(API), loadConfig(API)])
      .then(([ok, loaded]) => {
        if (!active) return;
        setConfig(loaded);
        setSession(ok ? "signedIn" : "signedOut");
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
    if (!desktop && !showLogin) return <Landing onSignIn={() => setShowLogin(true)} storeUrl={config.store_url} />;
    return loginWindow || !desktop
      ? <Login onSubmit={signIn} onSignUp={config.signup_enabled ? signUp : undefined} minimumPassword={config.minimum_password} />
      : null;
  }
  if (loginWindow) return <p style={{ fontFamily: "system-ui", padding: 16 }}>Opening the overlay…</p>;
  return <App onSignOut={signOut} localNetwork={config.local_network} storeUrl={config.store_url} />;
}
