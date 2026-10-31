import { authFetch } from "./auth.mjs";

export async function fetchInterviewHistory(api, search = "", limit = 100, offset = 0, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  const res = await authFetch(`${api}/api/v1/history?${params.toString()}`, {}, fetchImpl, storage, onExpired);
  if (!res.ok) throw new Error(`Failed to load interview history (${res.status})`);
  return res.json();
}

export async function addInterviewHistory(api, { question, answer, category = "general", sessionId = null }, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const res = await authFetch(
    `${api}/api/v1/history`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, answer, category, session_id: sessionId }),
    },
    fetchImpl, storage, onExpired
  );
  if (!res.ok) throw new Error(`Failed to add interview QA (${res.status})`);
  return res.json();
}

export async function deleteInterviewHistoryItem(api, id, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const res = await authFetch(`${api}/api/v1/history/${id}`, { method: "DELETE" }, fetchImpl, storage, onExpired);
  if (!res.ok) throw new Error(`Failed to delete history item (${res.status})`);
  return res.json();
}

export async function clearInterviewHistory(api, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const res = await authFetch(`${api}/api/v1/history`, { method: "DELETE" }, fetchImpl, storage, onExpired);
  if (!res.ok) throw new Error(`Failed to clear interview history (${res.status})`);
  return res.json();
}
