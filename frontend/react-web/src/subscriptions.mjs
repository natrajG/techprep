import { authFetch } from "./auth.mjs";

export async function fetchPlans(api, fetchImpl = fetch) {
  const res = await fetchImpl(`${api}/api/v1/subscription/plans`);
  if (!res.ok) throw new Error(`Failed to load plans (${res.status})`);
  return res.json();
}

export async function updatePlan(api, planId, changes, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const res = await authFetch(
    `${api}/api/v1/subscription/plans/${planId}`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) },
    fetchImpl, storage, onExpired
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : `Plan update failed (${res.status})`);
  }
  return res.json();
}

export async function fetchSubscriptionStatus(api, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const res = await authFetch(`${api}/api/v1/subscription/status`, {}, fetchImpl, storage, onExpired);
  if (!res.ok) throw new Error(`Failed to get subscription status (${res.status})`);
  return res.json();
}

export async function createPaymentOrder(api, planId, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const res = await authFetch(
    `${api}/api/v1/subscription/create-order`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_id: planId }),
    },
    fetchImpl,
    storage,
    onExpired
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Order creation failed (${res.status})`);
  }
  return res.json();
}

export async function verifyPayment(api, orderId, details, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const res = await authFetch(
    `${api}/api/v1/subscription/verify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: orderId, ...details }),
    },
    fetchImpl,
    storage,
    onExpired
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Payment verification failed (${res.status})`);
  }
  return res.json();
}

export async function uploadCustomQr(api, file, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await authFetch(
    `${api}/api/v1/subscription/upload-qr`,
    {
      method: "POST",
      body: formData,
    },
    fetchImpl,
    storage,
    onExpired
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Upload failed (${res.status})`);
  }
  return res.json();
}
