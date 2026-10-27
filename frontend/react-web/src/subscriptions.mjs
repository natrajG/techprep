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

// Warns when 10% or less of a multi-call plan's calls are left. A plan with one call never warns.
export function lowCallWarning(subscription) {
  if (subscription?.status !== "active") return null;
  const { calls_remaining: remaining, calls_total: total } = subscription;
  if (!Number.isInteger(remaining) || !Number.isInteger(total) || total < 2 || remaining < 1) return null;
  return remaining * 10 <= total ? { remaining, total } : null;
}

// Warns once an active call session has 5 minutes or less left before it expires.
const TIME_WARNING_THRESHOLD_SECONDS = 5 * 60;
export function timeRemainingWarning(subscription) {
  if (subscription?.status !== "active") return null;
  const remaining = subscription.call_time_remaining_seconds;
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > TIME_WARNING_THRESHOLD_SECONDS) return null;
  return { minutes: Math.max(1, Math.ceil(remaining / 60)) };
}
