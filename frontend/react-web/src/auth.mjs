const TOKEN_KEY = "authToken";

export const getToken = (storage = localStorage) => storage.getItem(TOKEN_KEY) || "";
export const clearToken = (storage = localStorage) => storage.removeItem(TOKEN_KEY);

export const login = (api, username, password, fetchImpl, storage) =>
  authenticate("login", api, username, password, fetchImpl, storage);
export const signup = (api, username, password, fetchImpl, storage) =>
  authenticate("signup", api, username, password, fetchImpl, storage);

async function authenticate(action, api, username, password, fetchImpl = fetch, storage = localStorage) {
  const response = await fetchImpl(`${api}/api/v1/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || `${action === "signup" ? "Sign up" : "Sign in"} failed (${response.status})`);
  storage.setItem(TOKEN_KEY, body.token);
  return body.user;
}

const DEFAULT_CONFIG = { signup_enabled: true, minimum_password: 8, local_network: true, store_url: null };

// Older servers have no config endpoint; keep their previous behavior. Network errors still propagate.
export async function loadConfig(api, fetchImpl = fetch) {
  const response = await fetchImpl(`${api}/api/v1/config`);
  if (response.status === 404) return DEFAULT_CONFIG;
  if (!response.ok) throw new Error(`Cannot load server configuration (${response.status})`);
  const body = await response.json();
  return {
    signup_enabled: body.signup_enabled === true,
    minimum_password: Number.isInteger(body.minimum_password) ? body.minimum_password : DEFAULT_CONFIG.minimum_password,
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
  return { ok: true, user: data.user || null };
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
