import { authFetch } from "./auth.mjs";

async function parseError(response, fallback) {
  const body = await response.json().catch(() => ({}));
  return typeof body.detail === "string" ? body.detail : fallback;
}

export async function getJobProfile(api, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const response = await authFetch(
    `${api}/api/v1/jobs/profile`,
    { method: "GET" },
    fetchImpl, storage, onExpired,
  );
  if (response.status === 401) throw new Error("Session expired. Sign in again.");
  if (!response.ok) throw new Error(await parseError(response, `Could not load job profile (${response.status}).`));
  return response.json();
}

export async function saveJobProfile(api, payload, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const response = await authFetch(
    `${api}/api/v1/jobs/profile/save`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    fetchImpl, storage, onExpired,
  );
  if (response.status === 401) throw new Error("Session expired. Sign in again.");
  if (!response.ok) throw new Error(await parseError(response, `Could not save job profile (${response.status}).`));
  return response.json();
}
