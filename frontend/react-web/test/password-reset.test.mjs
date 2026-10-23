import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchRecoveryEmail, loadConfig, readResetToken, requestPasswordReset, resetPassword, saveRecoveryEmail, signup,
} from "../src/auth.mjs";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const storage = () => {
  const values = new Map([["authToken", "session"]]);
  return { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
};

test("the reset token is read only from a well-formed fragment", () => {
  const token = "abcDEF123_-abcDEF123_-abcDEF123_-abcDEF123_-";
  assert.equal(readResetToken(`#reset=${token}`), token);
  for (const hash of ["", "#", "#reset=", "#reset=short", `#other=${token}`, `#reset=${token}&x=1`, `?reset=${token}`, `#reset=${token}<script>`]) {
    assert.equal(readResetToken(hash), null, hash);
  }
});

test("forgot password posts the email and returns the server message", async () => {
  const request = async (url, init) => {
    assert.equal(url, "https://api/api/v1/forgot-password");
    assert.deepEqual(JSON.parse(init.body), { email: "a@example.com" });
    return json(200, { message: "sent" });
  };
  assert.equal(await requestPasswordReset("https://api", "a@example.com", request), "sent");
});

test("reset password sends the token and surfaces server errors", async () => {
  const ok = async (url, init) => {
    assert.equal(url, "https://api/api/v1/reset-password");
    assert.deepEqual(JSON.parse(init.body), { token: "t", password: "new-password-1" });
    return json(200, { message: "done" });
  };
  assert.equal(await resetPassword("https://api", "t", "new-password-1", ok), "done");
  const expired = async () => json(400, { detail: "This reset link is invalid or has expired. Request a new one." });
  await assert.rejects(resetPassword("https://api", "t", "x", expired), /expired/);
});

test("signup sends the email and stores the session token", async () => {
  const store = storage();
  const request = async (url, init) => {
    assert.deepEqual(JSON.parse(init.body), { username: "bob", password: "pw", email: "b@example.com" });
    return json(200, { token: "new-token", user: "bob" });
  };
  assert.equal(await signup("https://api", "bob", "pw", "b@example.com", request, store), "bob");
  assert.equal(store.getItem("authToken"), "new-token");
});

test("recovery email calls are authenticated, and a wrong password does not sign the user out", async () => {
  const store = storage();
  const request = async (url, init) => {
    assert.ok(init.headers.Authorization.startsWith("Bearer "));
    if (init.method === "PUT") return json(403, { detail: "Incorrect password." });
    return json(200, { email: "a@example.com" });
  };
  assert.equal(await fetchRecoveryEmail("https://api", request, store), "a@example.com");
  await assert.rejects(saveRecoveryEmail("https://api", "a@example.com", "nope", request, store), /Incorrect password/);
  assert.equal(store.getItem("authToken"), "session");
});

test("config reports whether password reset is available", async () => {
  const config = (extra) => async () => json(200, { signup_enabled: false, minimum_password: 12, local_network: false, store_url: null, ...extra });
  assert.equal((await loadConfig("https://api", config({ password_reset_enabled: true }))).password_reset_enabled, true);
  assert.equal((await loadConfig("https://api", config({}))).password_reset_enabled, false);
});
