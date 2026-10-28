export function getMicStream(mediaDevices = navigator.mediaDevices) {
  return mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
}

// A simple single-take recorder: start it, speak, then call stop() to get back the
// recorded Blob plus how long the recording ran for. Much simpler than the chunked
// streaming recorder in audio-capture.mjs, which this feature doesn't need.
export function startSingleTakeRecording(stream, { Recorder = MediaRecorder, now = Date.now, onError = () => {} } = {}) {
  const recorder = new Recorder(stream, { mimeType: "audio/webm" });
  const parts = [];
  const startedAt = now();

  recorder.ondataavailable = (event) => {
    if (event.data.size) parts.push(event.data);
  };
  recorder.onerror = (event) => onError(event.error || new Error("Recorder failed"));
  recorder.start();

  return {
    stop: () => new Promise((resolve) => {
      recorder.onstop = () => {
        const durationSeconds = Math.max(0.1, (now() - startedAt) / 1000);
        resolve({ blob: new Blob(parts, { type: "audio/webm" }), durationSeconds });
      };
      if (recorder.state !== "inactive") recorder.stop();
      else recorder.onstop();
    }),
  };
}
