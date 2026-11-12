import { authFetch, getToken } from "./auth.mjs";

async function parseErrorDetail(response) {
  const data = response.headers.get("content-type")?.includes("application/json")
    ? await response.json().catch(() => null)
    : null;
  return typeof data?.detail === "string" ? `: ${data.detail}` : "";
}

export async function analyzeResume(api, resume, jd, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const response = await authFetch(
    `${api}/api/v1/resume-builder/analyze`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume, jd }),
    },
    fetchImpl, storage, onExpired
  );
  if (response.status === 401) throw new Error("Session expired. Sign in again.");
  if (response.status === 400) throw new Error((await response.json().catch(() => ({}))).detail || "Add your resume text first.");
  if (response.status === 429) throw new Error("Daily ATS score check limit reached. Try again tomorrow.");
  if (!response.ok) throw new Error(`Could not score your resume (HTTP ${response.status})${await parseErrorDetail(response)}`);
  return response.json();
}

export async function rebuildResume(api, resume, jd, analysisId, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const response = await authFetch(
    `${api}/api/v1/resume-builder/rebuild`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume, jd, analysis_id: analysisId ?? null }),
    },
    fetchImpl, storage, onExpired
  );
  if (response.status === 401) throw new Error("Session expired. Sign in again.");
  if (response.status === 400) throw new Error((await response.json().catch(() => ({}))).detail || "Add your resume text first.");
  if (response.status === 429) throw new Error("Daily resume rebuild limit reached. Try again tomorrow.");
  if (response.status === 502) throw new Error((await response.json().catch(() => ({}))).detail || "The resume rebuild service is unavailable right now.");
  if (!response.ok) throw new Error(`Could not rebuild your resume (HTTP ${response.status})${await parseErrorDetail(response)}`);
  return response.json();
}

export async function getResumeEntitlement(api, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const response = await authFetch(`${api}/api/v1/resume-builder/payment/entitlement`, {}, fetchImpl, storage, onExpired);
  if (!response.ok) throw new Error(`Could not check download access (HTTP ${response.status})`);
  return response.json();
}

export async function createResumePaymentOrder(api, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const response = await authFetch(
    `${api}/api/v1/resume-builder/payment/create-order`,
    { method: "POST" },
    fetchImpl, storage, onExpired
  );
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || `Could not start payment (HTTP ${response.status})`);
  return response.json();
}

export async function verifyResumePayment(api, orderId, details, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const response = await authFetch(
    `${api}/api/v1/resume-builder/payment/verify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: orderId, ...details }),
    },
    fetchImpl, storage, onExpired
  );
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || `Payment verification failed (HTTP ${response.status})`);
  return response.json();
}

export async function downloadResumeVersion(api, versionId, fmt, storage = localStorage) {
  const token = getToken(storage);
  const response = await fetch(`${api}/api/v1/resume-builder/version/${versionId}/download?fmt=${fmt}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 402) throw new Error((await response.json().catch(() => ({}))).detail || "Pay to unlock resume downloads.");
  if (!response.ok) throw new Error(`Could not download resume (HTTP ${response.status})`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `resume-rebuilt-${versionId}.${fmt}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
