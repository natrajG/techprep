const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const release = require("../build-mac-unsigned.cjs");

const env = { TECHPREP_SERVER_URL: "https://techprep-demo.duckdns.org" };

test("unsigned options require macOS and a public URL, but no Apple credentials", () => {
  assert.throws(() => release.unsignedOptions(env, "linux"), /on macOS/);
  assert.throws(() => release.unsignedOptions(env, "win32"), /on macOS/);
  assert.throws(() => release.unsignedOptions({ TECHPREP_SERVER_URL: "https://192.168.0.109:5173/" }, "darwin"), /public DNS/);
  assert.throws(() => release.unsignedOptions({ TECHPREP_SERVER_URL: undefined }, "darwin"), /HTTPS/);
  const options = release.unsignedOptions(env, "darwin");
  assert.equal(options.serverUrl, "https://techprep-demo.duckdns.org/");
});

test("unsigned build targets a fixed-name DMG, skips code signing identity, and never publishes from electron-builder", () => {
  const options = release.unsignedOptions(env, "darwin");
  const { config } = options.build;
  assert.equal(config.extraMetadata.techprepServerUrl, "https://techprep-demo.duckdns.org/");
  assert.deepEqual(config.mac.target, [{ target: "dmg", arch: ["x64"] }]);
  assert.equal(config.mac.identity, null);
  assert.deepEqual(config.dmg, { artifactName: "TechPrep.dmg" });
  assert.equal(options.build.publish, "never");
  assert.match(config.directories.output, /production-mac/);
});

test("manifest honestly labels an unsigned, un-notarized release", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "techprep-mac-unsigned-"));
  try {
    const installer = path.join(dir, "built.dmg");
    fs.writeFileSync(installer, "mac unsigned dmg");
    const manifest = release.releaseManifest({
      installer, serverUrl: "https://techprep-demo.duckdns.org/", version: "1.2.3", now: new Date(0),
    });
    assert.deepEqual(manifest, {
      schema: 1, file: "TechPrep.dmg", version: "1.2.3", serverUrl: "https://techprep-demo.duckdns.org/",
      size: 16, sha256: crypto.createHash("sha256").update("mac unsigned dmg").digest("hex"),
      signed: false, notarized: false, builtAt: "1970-01-01T00:00:00.000Z",
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("publish produces a matching installer/manifest pair, replacing an old mac release", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "techprep-mac-unsigned-publish-"));
  try {
    const installer = path.join(dir, "built.dmg");
    fs.writeFileSync(installer, "mac unsigned dmg");
    const manifest = release.releaseManifest({ installer, serverUrl: "https://techprep-demo.duckdns.org/", now: new Date(0) });
    const out = path.join(dir, "publish");
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, "desktop-release-mac.json"), "{\"old\":true}");
    fs.writeFileSync(path.join(out, "TechPrep.dmg"), "old installer");
    const published = release.publish(installer, manifest, out);
    assert.equal(fs.readFileSync(published.installer, "utf8"), "mac unsigned dmg");
    assert.deepEqual(JSON.parse(fs.readFileSync(published.manifest, "utf8")), manifest);
    assert.deepEqual(fs.readdirSync(out).sort(), ["TechPrep.dmg", "desktop-release-mac.json"]);
    assert.throws(() => release.publish(installer, { ...manifest, sha256: "0".repeat(64) }, out), /does not match/);
    assert.ok(!fs.existsSync(path.join(out, "desktop-release-mac.json")), "a mismatched build must leave no manifest");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
