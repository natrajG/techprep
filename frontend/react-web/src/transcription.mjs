import { authFetch } from "./auth.mjs";

export async function transcribeAudio(api, audio, fetchImpl = fetch, storage = localStorage, onExpired = () => {}) {
  const body = new FormData();
  body.append("audio", audio, "chunk.webm");
  const fetchAudio = async (...args) => {
    try {
      return await fetchImpl(...args);
    } catch (error) {
      throw new Error(
        "Cannot reach the transcription server. Check that it is running, the network is connected, " +
        `and its HTTPS certificate is trusted. ${error.message}`,
        { cause: error }
      );
    }
  };
  const response = await authFetch(`${api}/api/v1/transcribe`, { method: "POST", body }, fetchAudio, storage, onExpired);
  if (response.status === 401) throw new Error("Session expired. Sign in again.");
  if (!response.ok) {
    const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
    const detail = typeof data?.detail === "string" ? `: ${data.detail}` : "";
    throw new Error(`Transcription failed (HTTP ${response.status})${detail}`);
  }
  const data = await response.json();
  if (typeof data.text !== "string") throw new Error("The transcription server returned an invalid response.");
  return data.text;
}
