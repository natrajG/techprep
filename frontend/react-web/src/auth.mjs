const TOKEN_KEY = "authToken";

export const getToken = (storage = localStorage) => storage.getItem(TOKEN_KEY) || "";
export const clearToken = (storage = localStorage) => storage.removeItem(TOKEN_KEY);

export const login = (api, username, password, fetchImpl, storage) =>
  authenticate("login", api, { username, password }, fetchImpl, storage);
export const signup = (api, username, password, email, fetchImpl, storage) =>
  authenticate("signup", api, { username, password, email }, fetchImpl, storage);

// The server keeps one live session per account for the desktop app and one for the website.
const clientKindHeader = () => (typeof window !== "undefined" && window.desktop ? { "X-Client-Kind": "desktop" } : {});

async function authenticate(action, api, credentials, fetchImpl = fetch, storage = localStorage) {
  const response = await fetchImpl(`${api}/api/v1/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...clientKindHeader() },
    body: JSON.stringify(credentials),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(
      new Error(body.detail || `${action === "signup" ? "Sign up" : "Sign in"} failed (${response.status})`),
      { status: response.status },
    );
  }
  storage.setItem(TOKEN_KEY, body.token);
  return body.user;
}

const DEFAULT_CONFIG = {
  signup_enabled: true, minimum_password: 8, password_reset_enabled: false, local_network: true, store_url: null,
};

async function postJson(api, path, payload, fetchImpl) {
  const response = await fetchImpl(`${api}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : `Request failed (${response.status})`);
  return body;
}

export async function requestPasswordReset(api, email, fetchImpl = fetch) {
  return (await postJson(api, "/api/v1/forgot-password", { email }, fetchImpl)).message;
}

export async function resetPassword(api, token, password, fetchImpl = fetch) {
  return (await postJson(api, "/api/v1/reset-password", { token, password }, fetchImpl)).message;
}

// The reset link carries its token in the URL fragment: "#reset=<token>".
export function readResetToken(hash) {
  const match = /^#reset=([A-Za-z0-9_-]{20,200})$/.exec(hash || "");
  return match ? match[1] : null;
}

export async function fetchRecoveryEmail(api, fetchImpl = fetch, storage = localStorage) {
  const response = await authFetch(`${api}/api/v1/me`, {}, fetchImpl, storage);
  if (!response.ok) throw new Error(`Cannot load account details (${response.status})`);
  return (await response.json()).email || "";
}

export async function saveRecoveryEmail(api, email, password, fetchImpl = fetch, storage = localStorage) {
  const response = await authFetch(`${api}/api/v1/me/email`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }, fetchImpl, storage);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : `Could not save the email (${response.status})`);
  return body.email;
}

// Older servers have no config endpoint; keep their previous behavior. Network errors still propagate.
export async function loadConfig(api, fetchImpl = fetch) {
  const response = await fetchImpl(`${api}/api/v1/config`);
  if (response.status === 404) return DEFAULT_CONFIG;
  if (!response.ok) throw new Error(`Cannot load server configuration (${response.status})`);
  const body = await response.json();
  return {
    signup_enabled: body.signup_enabled === true,
    minimum_password: Number.isInteger(body.minimum_password) ? body.minimum_password : DEFAULT_CONFIG.minimum_password,
    password_reset_enabled: body.password_reset_enabled === true,
    local_network: body.local_network === true,
    store_url: typeof body.store_url === "string" && /^https:\/\/apps\.microsoft\.com\/detail\/[A-Za-z0-9]+$/.test(body.store_url)
      ? body.store_url : null,
  };
}

// True only when the saved token is accepted by the backend. A network error is thrown, not treated as signed out.
export async function checkSession(api, fetchImpl = fetch, storage = localStorage) {
  const token = getToken(storage);
  if (!token) return { ok: false, user: null };
  const response = await fetchImpl(`${api}/api/v1/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401) {
    clearToken(storage);
    return { ok: false, user: null };
  }
  if (!response.ok) return { ok: false, user: null };
  const data = await response.json().catch(() => ({}));
  return { ok: true, user: data.user || null, isAdmin: data.is_admin === true };
}

export async function authFetch(url, init = {}, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const response = await fetchImpl(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${getToken(storage)}` },
  });
  if (response.status === 401) {
    clearToken(storage);
    onExpired();
  }
  return response;
}
