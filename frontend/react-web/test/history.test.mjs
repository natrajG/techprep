import test from "node:test";
import assert from "node:assert/strict";
import { fetchInterviewHistory, addInterviewHistory, deleteInterviewHistoryItem, clearInterviewHistory } from "../src/history.mjs";

test("fetchInterviewHistory formats query params and sends auth headers", async () => {
  let requestedUrl = "";
  let headersSent = null;

  const mockFetch = async (url, opts) => {
    requestedUrl = url;
    headersSent = opts.headers;
    return {
      ok: true,
      json: async () => ({ items: [{ id: 1, question: "Q?", answer: "A!" }], total: 1 }),
    };
  };

  const mockStorage = {
    getItem: (k) => (k === "authToken" ? "valid-token" : null),
  };

  const res = await fetchInterviewHistory("http://localhost:8000", "React", 50, 0, mockFetch, mockStorage);
  assert.equal(res.total, 1);
  assert.equal(res.items[0].question, "Q?");
  assert.ok(requestedUrl.includes("search=React"));
  assert.ok(requestedUrl.includes("limit=50"));
  assert.equal(headersSent.Authorization, "Bearer valid-token");
});

test("addInterviewHistory sends POST with payload", async () => {
  let postedBody = null;
  const mockFetch = async (_url, opts) => {
    postedBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ status: "success", id: 42 }) };
  };
  const mockStorage = { getItem: () => "tok" };

  const res = await addInterviewHistory("http://localhost", { question: "Q1", answer: "A1" }, mockFetch, mockStorage);
  assert.equal(res.id, 42);
  assert.equal(postedBody.question, "Q1");
  assert.equal(postedBody.answer, "A1");
});
