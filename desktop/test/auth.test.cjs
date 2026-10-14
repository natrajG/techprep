const { test } = require("node:test");
const assert = require("node:assert/strict");
const auth = import("../../frontend/react-web/src/auth.mjs");

function storage() {
  const values = new Map();
  return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) };
}
const reply = (status, body = {}) => async () => ({ status, ok: status < 400, json: async () => body });

test("login stores the token and returns the user", async () => {
  const { login, getToken } = await auth;
  const saved = storage();
  assert.equal(await login("", "admin", "pw", reply(200, { token: "t1", user: "admin" }), saved), "admin");
  assert.equal(getToken(saved), "t1");
});

test("failed login shows the server message and stores nothing", async () => {
  const { login, getToken } = await auth;
  const saved = storage();
  await assert.rejects(login("", "a", "b", reply(401, { detail: "Incorrect username or password" }), saved), /Incorrect username/);
  assert.equal(getToken(saved), "");
});

test("session check: no token, valid token, rejected token is cleared, network error is thrown", async () => {
  const { checkSession, getToken } = await auth;
  const saved = storage();
  assert.equal(await checkSession("", reply(200), saved), false);
  saved.setItem("authToken", "t");
  assert.equal(await checkSession("", reply(200), saved), true);
  assert.equal(await checkSession("", reply(401), saved), false);
  assert.equal(getToken(saved), "");
  saved.setItem("authToken", "t");
  await assert.rejects(checkSession("", async () => { throw new Error("offline"); }, saved), /offline/);
  assert.equal(getToken(saved), "t");
});

test("authFetch sends the bearer token and signs out on 401", async () => {
  const { authFetch, getToken } = await auth;
  const saved = storage();
  saved.setItem("authToken", "t9");
  let sent;
  let expired = 0;
  const fetchImpl = async (_url, init) => { sent = init; return { status: 401 }; };
  await authFetch("/x", { method: "POST", headers: { "Content-Type": "application/json" } }, fetchImpl, saved, () => expired++);
  assert.equal(sent.headers.Authorization, "Bearer t9");
  assert.equal(sent.headers["Content-Type"], "application/json");
  assert.equal(expired, 1);
  assert.equal(getToken(saved), "");
});

test("signup stores the token, and surfaces server validation errors", async () => {
  const { signup, getToken } = await auth;
  const saved = storage();
  let url;
  const ok = async (u) => { url = u; return { status: 200, ok: true, json: async () => ({ token: "n1", user: "newbie" }) }; };
  assert.equal(await signup("", "newbie", "longenough", ok, saved), "newbie");
  assert.equal(url, "/api/v1/signup");
  assert.equal(getToken(saved), "n1");
  const other = storage();
  await assert.rejects(signup("", "x", "y", reply(409, { detail: "That username is already taken" }), other), /already taken/);
  assert.equal(getToken(other), "");
});

test("server config: production values, legacy servers, and failures", async () => {
  const { loadConfig } = await auth;
  assert.deepEqual(await loadConfig("", reply(200, { signup_enabled: false, minimum_password: 12, local_network: false, store_url: "https://apps.microsoft.com/detail/9N36X6C5706B" })),
    { signup_enabled: false, minimum_password: 12, local_network: false, store_url: "https://apps.microsoft.com/detail/9N36X6C5706B" });
  assert.deepEqual(await loadConfig("", reply(404)), { signup_enabled: true, minimum_password: 8, local_network: true, store_url: null });
  assert.deepEqual(await loadConfig("", reply(200, { signup_enabled: "yes", minimum_password: "x" })),
    { signup_enabled: false, minimum_password: 8, local_network: false, store_url: null });
  assert.equal((await loadConfig("", reply(200, { store_url: "javascript:alert(1)" }))).store_url, null);
  await assert.rejects(loadConfig("", reply(500)), /500/);
  await assert.rejects(loadConfig("", async () => { throw new Error("offline"); }), /offline/);
});
