import assert from "node:assert/strict";
import { test } from "node:test";
import { getMicStream, startSingleTakeRecording } from "./mock-recorder.mjs";

class FakeRecorder {
  constructor(stream, options) {
    this.stream = stream;
    this.options = options;
    this.state = "inactive";
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: { size: 4 } });
    this.onstop?.();
  }
}

test("getMicStream requests a processed microphone-only stream", async () => {
  const stream = {};
  const requests = [];
  const mediaDevices = {
    getUserMedia(constraints) {
      requests.push(constraints);
      return Promise.resolve(stream);
    },
  };
  assert.equal(await getMicStream(mediaDevices), stream);
  assert.deepEqual(requests, [{
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  }]);
});

test("startSingleTakeRecording resolves a blob and elapsed duration on stop", async () => {
  let elapsed = 1000;
  const recording = startSingleTakeRecording({}, {
    Recorder: FakeRecorder,
    now: () => elapsed,
  });
  elapsed = 4500;
  const { blob, durationSeconds } = await recording.stop();
  assert.ok(blob instanceof Blob);
  assert.equal(durationSeconds, 3.5);
});

test("startSingleTakeRecording surfaces recorder errors via onError", () => {
  let captured;
  const recorder = new FakeRecorder({}, {});
  recorder.start();
  const onError = (error) => { captured = error; };
  recorder.onerror = (event) => onError(event.error || new Error("Recorder failed"));
  const failure = new Error("boom");
  recorder.onerror({ error: failure });
  assert.equal(captured, failure);
});
