import { authFetch } from "./auth.mjs";

async function parseErrorDetail(response) {
  const data = response.headers.get("content-type")?.includes("application/json")
    ? await response.json().catch(() => null)
    : null;
  return typeof data?.detail === "string" ? `: ${data.detail}` : "";
}

export async function fetchNextQuestion(api, role, history = [], fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const response = await authFetch(
    `${api}/api/v1/mock-interview/next`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, history }),
    },
    fetchImpl, storage, onExpired
  );
  if (response.status === 401) throw new Error("Session expired. Sign in again.");
  if (response.status === 429) throw new Error("Daily practice limit reached. Come back tomorrow for more questions.");
  if (!response.ok) throw new Error(`Could not get the next question (HTTP ${response.status})${await parseErrorDetail(response)}`);
  const data = await response.json();
  if (typeof data.question !== "string" || typeof data.sample_answer !== "string") {
    throw new Error("Mock Interview server returned an invalid response.");
  }
  return data;
}

export async function fetchMockFeedback(api, { audio, question, sampleAnswer, durationSeconds }, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const body = new FormData();
  body.append("audio", audio, "answer.webm");
  body.append("question", question);
  body.append("sample_answer", sampleAnswer);
  body.append("duration_seconds", String(durationSeconds));
  const fetchAudio = async (...args) => {
    try {
      return await fetchImpl(...args);
    } catch (error) {
      throw new Error(
        "Cannot reach the practice server. Check that it is running and the network is connected. " + error.message,
        { cause: error }
      );
    }
  };
  const response = await authFetch(`${api}/api/v1/mock-interview/feedback`, { method: "POST", body }, fetchAudio, storage, onExpired);
  if (response.status === 401) throw new Error("Session expired. Sign in again.");
  if (!response.ok) throw new Error(`Could not analyze your answer (HTTP ${response.status})${await parseErrorDetail(response)}`);
  const data = await response.json();
  if (typeof data.transcript !== "string" || typeof data.feedback !== "string") {
    throw new Error("Mock Interview server returned an invalid response.");
  }
  return data;
}
