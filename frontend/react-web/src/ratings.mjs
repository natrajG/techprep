import { authFetch } from "./auth.mjs";

export async function submitRating(api, stars, context, comment = "", fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const res = await authFetch(
    `${api}/api/v1/ratings`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stars, context, comment: comment || undefined }),
    },
    fetchImpl, storage, onExpired
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : `Rating could not be sent (${res.status})`);
  }
  return res.json();
}

// Public, unauthenticated: used for the "N users rated" social-proof badge on the marketing site.
export async function fetchRatingSummary(api, fetchImpl = fetch) {
  const res = await fetchImpl(`${api}/api/v1/ratings/summary`);
  if (!res.ok) throw new Error(`Failed to load rating summary (${res.status})`);
  return res.json();
}
