import { authFetch } from "./auth.mjs";

const isDesktop = () => typeof window !== "undefined" && Boolean(window.desktop);

export async function submitFeedback(api, category, message, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const res = await authFetch(
    `${api}/api/v1/feedback`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, message, source: isDesktop() ? "desktop" : "web" }),
    },
    fetchImpl, storage, onExpired
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : `Feedback could not be sent (${res.status})`);
  }
  return res.json();
}

export async function fetchFeedback(api, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const res = await authFetch(`${api}/api/v1/feedback`, {}, fetchImpl, storage, onExpired);
  if (!res.ok) throw new Error(`Failed to load feedback (${res.status})`);
  return res.json();
}

export async function updateFeedbackStatus(api, id, status, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const res = await authFetch(
    `${api}/api/v1/feedback/${id}`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) },
    fetchImpl, storage, onExpired
  );
  if (!res.ok) throw new Error(`Failed to update feedback (${res.status})`);
  return res.json();
}

export async function deleteFeedback(api, id, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const res = await authFetch(`${api}/api/v1/feedback/${id}`, { method: "DELETE" }, fetchImpl, storage, onExpired);
  if (!res.ok) throw new Error(`Failed to delete feedback (${res.status})`);
  return res.json();
}

export async function clearResolvedFeedback(api, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const res = await authFetch(`${api}/api/v1/feedback/resolved`, { method: "DELETE" }, fetchImpl, storage, onExpired);
  if (!res.ok) throw new Error(`Failed to clear resolved feedback (${res.status})`);
  return res.json();
}
