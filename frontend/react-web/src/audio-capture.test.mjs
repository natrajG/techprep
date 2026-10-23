import assert from "node:assert/strict";
import { test } from "node:test";
import { startChunkRecorder, captureSystemAudio } from "./audio-capture.mjs";

test("display capture requests system audio without microphone processing constraints", async () => {
  const stream = {};
  const requests = [];
  const mediaDevices = {
    getDisplayMedia(constraints) {
      requests.push(constraints);
      return Promise.resolve(stream);
    },
    getUserMedia() {
      throw new Error("Must not fall back to microphone capture");
    },
  };
  assert.equal(await captureSystemAudio(mediaDevices, false), stream);
  assert.deepEqual(requests, [{ audio: true, video: true }]);
});

test("display capture failures propagate without a microphone fallback", async () => {
  const error = new Error("Invalid capture constraints");
  const mediaDevices = {
    getDisplayMedia() { return Promise.reject(error); },
    getUserMedia() { throw new Error("Must not fall back to microphone capture"); },
  };
  await assert.rejects(captureSystemAudio(mediaDevices, false), (reason) => reason === error);
});

test("Linux monitor capture retains unprocessed audio input", async () => {
  const requests = [];
  const mediaDevices = {
    getUserMedia(constraints) {
      requests.push(constraints);
      return Promise.resolve({});
    },
    getDisplayMedia() { throw new Error("Monitor input must not use display capture"); },
  };
  await captureSystemAudio(mediaDevices, true);
  assert.deepEqual(requests, [{
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  }]);
});

function setup() {
  const timers = new Map();
  const intervals = new Map();
  const recorders = [];
  let nextId = 0;
  let time = 0;
  let level = 0;

  class Recorder {
    constructor() {
      this.state = "inactive";
      recorders.push(this);
    }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      this.ondataavailable({ data: new Blob(["recorded audio"]) });
      this.onstop();
    }
  }

  const recorder = (callbacks) => startChunkRecorder({
    stream: {},
    analyser: {
      fftSize: 4,
      getFloatTimeDomainData(samples) { samples.fill(level); },
    },
    Recorder,
    schedule(fn) { const id = ++nextId; timers.set(id, fn); return id; },
    cancel(id) { timers.delete(id); },
    repeat(fn) { const id = ++nextId; intervals.set(id, fn); return id; },
    cancelRepeat(id) { intervals.delete(id); },
    now: () => time,
    ...callbacks,
  });

  return {
    recorder, recorders,
    advance(ms) { time += ms; },
    setLevel(value) { level = value; },
    sample() {
      for (const fn of [...intervals.values()]) fn();
    },
    tick() {
      this.sample();
      for (const fn of [...timers.values()]) fn();
    },
    get pendingTimers() { return timers.size + intervals.size; },
  };
}

test("records quiet speech and starts the next standalone chunk only after stopping", () => {
  const fake = setup();
  const chunks = [];
  const stop = fake.recorder({
    onChunk: (blob) => chunks.push(blob),
    onSilence: () => {},
    onError: (error) => { throw error; },
  });
  fake.setLevel(0.005);
  fake.tick();
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].type, "audio/webm");
  assert.equal(fake.recorders.length, 2);
  assert.equal(fake.recorders[0].state, "inactive");
  stop();
  assert.equal(fake.recorders.length, 2);
  assert.equal(fake.pendingTimers, 0);
});

test("reports missing audio instead of silently discarding repeated chunks", () => {
  const fake = setup();
  let silentWarnings = 0;
  const chunks = [];
  const stop = fake.recorder({
    onChunk: (blob) => chunks.push(blob),
    onSilence: () => { silentWarnings++; },
    onError: (error) => { throw error; },
  });
  fake.tick();
  fake.tick();
  assert.equal(chunks.length, 0);
  assert.equal(silentWarnings, 1);
  stop();
  assert.equal(silentWarnings, 1);
  assert.equal(fake.pendingTimers, 0);
});

test("tags each chunk at recording start so Clear cannot restore old speech", () => {
  const fake = setup();
  let epoch = 1;
  const tags = [];
  const stop = fake.recorder({
    onCycleStart: () => epoch,
    onChunk: (_blob, tag) => tags.push(tag),
    onSilence: () => {},
    onError: (error) => { throw error; },
  });
  fake.setLevel(0.005);
  epoch = 2;
  fake.tick();
  fake.tick();
  fake.sample();
  stop();
  assert.deepEqual(tags, [1, 2, 2]);
});

test("finishes a chunk and reports a single pause after speech stops", () => {
  const fake = setup();
  const chunks = [];
  let pauses = 0;
  const stop = fake.recorder({
    onChunk: (blob) => chunks.push(blob),
    onSilence: () => {},
    onPause: () => { pauses++; },
    onError: (error) => { throw error; },
  });
  fake.setLevel(0.005);
  fake.sample();
  fake.tick();
  fake.setLevel(0);
  fake.advance(1799);
  fake.sample();
  assert.equal(pauses, 0);
  fake.advance(2);
  fake.sample();
  assert.equal(pauses, 1);
  assert.equal(chunks.length, 1);
  fake.advance(6000);
  fake.sample();
  assert.equal(pauses, 1);
  stop();
});

test("a second utterance causes one new pause, not repeated answers for silence", () => {
  const fake = setup();
  let pauses = 0;
  const stop = fake.recorder({
    onChunk: () => {},
    onSilence: () => {},
    onPause: () => { pauses++; },
    onError: (error) => { throw error; },
  });
  for (let i = 0; i < 2; i++) {
    fake.setLevel(0.005);
    fake.sample();
    fake.setLevel(0);
    fake.advance(1800);
    fake.sample();
    assert.equal(pauses, i + 1);
    fake.advance(6000);
    fake.sample();
    assert.equal(pauses, i + 1);
  }
  stop();
});
