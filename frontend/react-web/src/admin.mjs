import { authFetch } from "./auth.mjs";

export async function fetchAdminUsers(api, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const res = await authFetch(`${api}/api/v1/admin/users`, {}, fetchImpl, storage, onExpired);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : `Failed to load users (${res.status})`);
  }
  return res.json();
}

export async function grantAdminSubscription(api, payload, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const res = await authFetch(
    `${api}/api/v1/admin/grant-subscription`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    fetchImpl, storage, onExpired
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : `Failed to grant subscription (${res.status})`);
  }
  return res.json();
}

export async function revokeAdminSubscription(api, payload, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const res = await authFetch(
    `${api}/api/v1/admin/revoke-subscription`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    fetchImpl, storage, onExpired
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : `Failed to revoke subscription (${res.status})`);
  }
  return res.json();
}
