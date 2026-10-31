import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchDownload } from "../src/downloads.mjs";

function storage() {
  const values = new Map([["authToken", "download-session"]]);
  return { getItem: (key) => values.get(key), removeItem: (key) => values.delete(key) };
}

test("downloads use an authorization header, not a token in the URL", async () => {
  for (const [target, filename, type] of [
    ["windows", "TechPrep-Setup.exe", "application/octet-stream"],
    ["mac", "TechPrep.dmg", "application/x-apple-diskimage"],
    ["ca", "TechPrep-Local-CA.crt", "application/x-x509-ca-cert"],
  ]) {
    const request = async (url, init) => {
      assert.equal(url, `https://server/api/v1/downloads/${target}`);
      assert.equal(init.headers.Authorization, "Bearer download-session");
      return new Response("file-content", { headers: { "Content-Type": type } });
    };
    const result = await fetchDownload("https://server", target, request, storage());
    assert.equal(result.filename, filename);
    assert.equal(await result.blob.text(), "file-content");
  }
});

test("an expired session is cleared and not downloaded as a file", async () => {
  const saved = storage();
  let expired = false;
  await assert.rejects(fetchDownload("", "windows", async () => new Response("", { status: 401 }),
    saved, () => { expired = true; }), /Sign in again/);
  assert.equal(saved.getItem("authToken"), undefined);
  assert.equal(expired, true);
});

test("missing releases and server failures surface useful errors", async () => {
  await assert.rejects(fetchDownload("", "windows", async () => Response.json(
    { detail: "Installer not ready" }, { status: 503 }
  ), storage()), /Installer not ready/);
  await assert.rejects(fetchDownload("", "windows", async () => new Response("Bad gateway", {
    status: 502,
  }), storage()), /Download failed \(502\)/);
  await assert.rejects(fetchDownload("", "windows", async () => { throw new Error("offline"); },
    storage()), /offline/);
});

test("an HTML fallback cannot be saved as an installer", async () => {
  await assert.rejects(fetchDownload("", "windows", async () => new Response("<html></html>", {
    headers: { "Content-Type": "text/html" },
  }), storage()), /did not return the requested download/);
});

test("unknown download targets are rejected before requesting", async () => {
  await assert.rejects(fetchDownload("", "../ca-key.pem", () => assert.fail("Must not fetch"),
    storage()), /Unsupported download/);
});
