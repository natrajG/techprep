import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchAdminUsers, grantAdminSubscription, revokeAdminSubscription } from "../src/admin.mjs";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const storage = () => {
  const values = new Map([["authToken", "admin-session-token"]]);
  return { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
};

test("fetchAdminUsers sends auth token and returns user list with summary", async () => {
  const store = storage();
  const mockFetch = async (url, init) => {
    assert.equal(url, "https://api/api/v1/admin/users");
    assert.equal(init.headers.Authorization, "Bearer admin-session-token");
    return json(200, {
      users: [{ username: "alice", email: "alice@example.com", token_usage: { total_tokens: 100 } }],
      summary: { total_users: 1, total_active_subs: 1 },
    });
  };

  const data = await fetchAdminUsers("https://api", mockFetch, store);
  assert.equal(data.users.length, 1);
  assert.equal(data.users[0].username, "alice");
  assert.equal(data.summary.total_users, 1);
});

test("grantAdminSubscription sends valid grant payload", async () => {
  const store = storage();
  const mockFetch = async (url, init) => {
    assert.equal(url, "https://api/api/v1/admin/grant-subscription");
    assert.equal(init.method, "POST");
    const payload = JSON.parse(init.body);
    assert.equal(payload.username, "bob");
    assert.equal(payload.plan_id, "monthly");
    assert.equal(payload.amount, 0);
    return json(200, { status: "success", message: "Plan granted" });
  };

  const res = await grantAdminSubscription(
    "https://api",
    { username: "bob", plan_id: "monthly", amount: 0 },
    mockFetch,
    store
  );
  assert.equal(res.status, "success");
});

test("revokeAdminSubscription sends revocation payload", async () => {
  const store = storage();
  const mockFetch = async (url, init) => {
    assert.equal(url, "https://api/api/v1/admin/revoke-subscription");
    assert.equal(init.method, "POST");
    const payload = JSON.parse(init.body);
    assert.equal(payload.username, "charlie");
    return json(200, { status: "success", message: "Plan revoked" });
  };

  const res = await revokeAdminSubscription("https://api", { username: "charlie" }, mockFetch, store);
  assert.equal(res.status, "success");
});
