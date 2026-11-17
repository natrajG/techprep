import { authFetch } from "./auth.mjs";

async function parseError(response, fallback) {
  const body = await response.json().catch(() => ({}));
  return typeof body.detail === "string" ? body.detail : fallback;
}

export async function suggestJobSearch(api, resume, jd, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const response = await authFetch(
    `${api}/api/v1/jobs/suggest`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume, jd }),
    },
    fetchImpl, storage, onExpired,
  );
  if (response.status === 401) throw new Error("Session expired. Sign in again.");
  if (response.status === 400) throw new Error(await parseError(response, "Add your resume first."));
  if (response.status === 429) throw new Error("Daily suggestion limit reached. Try again tomorrow.");
  if (!response.ok) throw new Error(await parseError(response, `Could not suggest defaults (${response.status}).`));
  return response.json();
}

export async function searchJobs(api, payload, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const response = await authFetch(
    `${api}/api/v1/jobs/search`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    fetchImpl, storage, onExpired,
  );
  if (response.status === 401) throw new Error("Session expired. Sign in again.");
  if (response.status === 400) throw new Error(await parseError(response, "Role is required."));
  if (response.status === 429) throw new Error("Daily job search limit reached. Try again tomorrow.");
  if (response.status === 503) throw new Error(await parseError(response, "No job provider is currently available."));
  if (!response.ok) throw new Error(await parseError(response, `Could not search jobs (${response.status}).`));
  return response.json();
}
