export function startChunkRecorder({
  stream, analyser, onChunk, onSilence, onError,
  onActivity = () => {}, onPause = () => {},
  onCycleStart = () => undefined,
  chunkMs = 6000, silencePeak = 0.001, pauseMs = 1800,
  Recorder = MediaRecorder,
  schedule = setTimeout, cancel = clearTimeout,
  repeat = setInterval, cancelRepeat = clearInterval,
  now = Date.now,
}) {
  let active = true;
  let recorder;
  let timer;
  let meter;
  let silentChunks = 0;
  let lastActivity = null;

  function recordCycle() {
    if (!active) return;
    try {
      recorder = new Recorder(stream, { mimeType: "audio/webm" });
      const current = recorder;
      const parts = [];
      const samples = new Float32Array(analyser.fftSize);
      const cycleTag = onCycleStart();
      let peak = 0;
      let paused = false;

      current.ondataavailable = (event) => {
        if (event.data.size) parts.push(event.data);
      };
      current.onstop = () => {
        cancelRepeat(meter);
        cancel(timer);
        if (parts.length && peak > silencePeak) {
          silentChunks = 0;
          onChunk(new Blob(parts, { type: "audio/webm" }), cycleTag);
        } else if (active && ++silentChunks >= 2) {
          onSilence();
        }
        if (paused && active) {
          lastActivity = null;
          onPause();
        }
        recordCycle();
      };
      current.onerror = (event) => {
        active = false;
        cancelRepeat(meter);
        cancel(timer);
        onError(event.error || new Error("Audio recorder failed"));
      };
      current.start();
      meter = repeat(() => {
        analyser.getFloatTimeDomainData(samples);
        let framePeak = 0;
        for (const value of samples) framePeak = Math.max(framePeak, Math.abs(value));
        peak = Math.max(peak, framePeak);
        if (framePeak > silencePeak) {
          lastActivity = now();
          onActivity();
        } else if (lastActivity !== null && !paused && now() - lastActivity >= pauseMs) {
          paused = true;
          if (current.state === "recording") current.stop();
        }
      }, 100);
      timer = schedule(() => {
        if (current.state === "recording") current.stop();
      }, chunkMs);
    } catch (error) {
      active = false;
      cancelRepeat(meter);
      cancel(timer);
      onError(error);
    }
  }

  recordCycle();
  return () => {
    active = false;
    cancel(timer);
    if (recorder?.state === "recording") recorder.stop();
  };
}
