const { test } = require("node:test");
const assert = require("node:assert/strict");
const transcription = import("../../frontend/react-web/src/transcription.mjs");
const storage = { getItem: () => "test-token", removeItem() {} };
const audio = new Blob(["audio"], { type: "audio/webm" });

test("transcription uploads only audio to the same-origin API with authentication", async () => {
  const { transcribeAudio } = await transcription;
  const text = await transcribeAudio("", audio, async (url, request) => {
    assert.equal(url, "/api/v1/transcribe");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.Authorization, "Bearer test-token");
    assert.deepEqual([...request.body.keys()], ["audio"]);
    assert.equal(request.body.get("audio").type, "audio/webm");
    return Response.json({ text: "Call audio" });
  }, storage);
  assert.equal(text, "Call audio");
});

test("network failures explain server, connection, and certificate requirements", async () => {
  const { transcribeAudio } = await transcription;
  await assert.rejects(
    transcribeAudio("", audio, async () => { throw new TypeError("Failed to fetch"); }, storage),
    /server.*running.*network.*certificate.*trusted.*Failed to fetch/
  );
});

test("HTTP errors surface backend details or the non-JSON proxy status", async () => {
  const { transcribeAudio } = await transcription;
  await assert.rejects(transcribeAudio("", audio,
    async () => Response.json({ detail: "Audio chunk too large" }, { status: 413 }), storage), /HTTP 413.*Audio chunk too large/);
  await assert.rejects(transcribeAudio("", audio,
    async () => new Response("Bad gateway", { status: 502 }), storage), /HTTP 502/);
});

test("expired sessions notify the UI and stop treating an error as a transcript", async () => {
  const { transcribeAudio } = await transcription;
  let expired = 0;
  await assert.rejects(transcribeAudio("", audio,
    async () => Response.json({ detail: "Unauthorized" }, { status: 401 }), storage, () => expired++), /Session expired/);
  assert.equal(expired, 1);
});

test("empty speech is valid but a malformed successful response is not", async () => {
  const { transcribeAudio } = await transcription;
  assert.equal(await transcribeAudio("", audio, async () => Response.json({ text: "" }), storage), "");
  await assert.rejects(transcribeAudio("", audio, async () => Response.json({}), storage), /invalid response/);
});

test("storage failures are not mislabeled as network failures", async () => {
  const { transcribeAudio } = await transcription;
  const deniedStorage = { getItem() { throw new Error("Storage access denied"); } };
  await assert.rejects(transcribeAudio("", audio, assert.fail, deniedStorage), /^Error: Storage access denied$/);
});
