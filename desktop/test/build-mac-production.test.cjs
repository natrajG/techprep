const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const release = require("../build-mac-production.cjs");

const TEAM_ID = "ABCDE12345";
const env = {
  TECHPREP_SERVER_URL: "https://techprep-demo.duckdns.org",
  TECHPREP_SIGNER_TEAM_ID: TEAM_ID,
  APPLE_ID: "owner@example.com",
  APPLE_APP_SPECIFIC_PASSWORD: "abcd-efgh-ijkl-mnop",
  APPLE_TEAM_ID: TEAM_ID,
};

test("production options require macOS, a public URL, the team ID, and matching Apple notarization credentials", () => {
  assert.throws(() => release.productionOptions(env, "linux"), /on macOS/);
  assert.throws(() => release.productionOptions(env, "win32"), /on macOS/);
  assert.throws(() => release.productionOptions({ ...env, TECHPREP_SERVER_URL: "https://192.168.0.109:5173/" }, "darwin"), /public DNS/);
  assert.throws(() => release.productionOptions({ ...env, TECHPREP_SERVER_URL: undefined }, "darwin"), /HTTPS/);
  for (const bad of [undefined, "", "abc", "toolongteamid", "ABCDE1234", "ABCDE123456"]) {
    assert.throws(() => release.productionOptions({ ...env, TECHPREP_SIGNER_TEAM_ID: bad }, "darwin"), /Team ID/);
  }
  for (const key of ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]) {
    const { [key]: _omit, ...missing } = env;
    assert.throws(() => release.productionOptions(missing, "darwin"), /notarize/);
  }
  assert.throws(() => release.productionOptions({ ...env, APPLE_TEAM_ID: "ZZZZZ99999" }, "darwin"), /must match/);
});

test("production build targets a fixed-name DMG, forces hardened runtime, and never publishes from electron-builder", () => {
  const options = release.productionOptions(env, "darwin");
  assert.equal(options.teamId, TEAM_ID);
  const { config } = options.build;
  assert.equal(config.extraMetadata.techprepServerUrl, "https://techprep-demo.duckdns.org/");
  assert.deepEqual(config.mac.target, [{ target: "dmg", arch: ["x64"] }]);
  assert.equal(config.mac.hardenedRuntime, true);
  assert.deepEqual(config.dmg, { artifactName: "TechPrep.dmg" });
  assert.equal(options.build.publish, "never");
  assert.match(config.directories.output, /production-mac/);
});

test("team ID normalization accepts lowercase/whitespace and rejects malformed values", () => {
  assert.equal(release.normalizeTeamId(` ${TEAM_ID.toLowerCase()} `), TEAM_ID);
  for (const bad of [undefined, "", "short", `${TEAM_ID}1`, "!!!!!!!!!!"]) {
    assert.throws(() => release.normalizeTeamId(bad), /Team ID/);
  }
});

test("signature reading parses the signing team and Gatekeeper/notarization status from codesign and spctl output", () => {
  const codesignOutput = [
    "Executable=/path/TechPrep.app/Contents/MacOS/TechPrep",
    "Authority=Developer ID Application: Example Inc (ABCDE12345)",
    "Authority=Developer ID Certification Authority",
    "Authority=Apple Root CA",
  ].join("\n");
  const spctlOutput = "/path/TechPrep.app: accepted\nsource=Notarized Developer ID\n";
  const calls = [];
  const execute = (command, args) => {
    calls.push({ command, args });
    if (command === "codesign") return { status: 0, stdout: "", stderr: codesignOutput };
    return { status: 0, stdout: "", stderr: spctlOutput };
  };
  const signature = release.readSignature("/path/TechPrep.app", execute);
  assert.deepEqual(signature, {
    signed: true, authority: "Developer ID Application: Example Inc (ABCDE12345)",
    teamId: "ABCDE12345", accepted: true, notarized: true,
  });
  assert.equal(calls[0].command, "codesign");
  assert.deepEqual(calls[0].args, ["-dvvv", "/path/TechPrep.app"]);
  assert.equal(calls[1].command, "spctl");
  assert.deepEqual(calls[1].args, ["-a", "-t", "exec", "-vv", "/path/TechPrep.app"]);
});

test("signature reading reports failure when codesign/spctl reject the artifact or it is ad-hoc signed", () => {
  const execute = (command) => (
    command === "codesign"
      ? { status: 1, stdout: "", stderr: "code object is not signed at all" }
      : { status: 3, stdout: "", stderr: "rejected\nsource=Unnotarized Developer ID" }
  );
  const signature = release.readSignature("/path/TechPrep.dmg", execute);
  assert.deepEqual(signature, { signed: false, authority: null, teamId: null, accepted: false, notarized: false });
});

test("signature verification requires a signed, correctly-teamed, Gatekeeper-accepted, notarized artifact", () => {
  const good = { signed: true, teamId: TEAM_ID, authority: "Developer ID Application: Example Inc (ABCDE12345)", accepted: true, notarized: true };
  assert.deepEqual(release.checkSignature("/a/TechPrep.dmg", good, TEAM_ID), { authority: good.authority, teamId: TEAM_ID });
  for (const [change, message] of [
    [{ signed: false }, /not validly code-signed/],
    [{ teamId: "ZZZZZ99999" }, /unexpected Developer ID/],
    [{ teamId: null }, /unexpected Developer ID/],
    [{ accepted: false }, /Gatekeeper/],
    [{ notarized: false }, /not notarized/],
  ]) {
    assert.throws(() => release.checkSignature("TechPrep.dmg", { ...good, ...change }, TEAM_ID), message);
  }
});

test("manifest and publish produce a matching installer/manifest pair, replacing an old mac release", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "techprep-mac-release-"));
  try {
    const installer = path.join(dir, "built.dmg");
    fs.writeFileSync(installer, "mac signed dmg");
    const signer = { authority: "Developer ID Application: Example Inc (ABCDE12345)", teamId: TEAM_ID };
    const manifest = release.releaseManifest({
      installer, serverUrl: "https://techprep-demo.duckdns.org/", signer, version: "1.2.3", now: new Date(0),
    });
    assert.deepEqual(manifest, {
      schema: 1, file: "TechPrep.dmg", version: "1.2.3", serverUrl: "https://techprep-demo.duckdns.org/",
      size: 14, sha256: crypto.createHash("sha256").update("mac signed dmg").digest("hex"),
      signed: true, notarized: true, signer, builtAt: "1970-01-01T00:00:00.000Z",
    });
    const out = path.join(dir, "publish");
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, "desktop-release-mac.json"), "{\"old\":true}");
    fs.writeFileSync(path.join(out, "TechPrep.dmg"), "old installer");
    const published = release.publish(installer, manifest, out);
    assert.equal(fs.readFileSync(published.installer, "utf8"), "mac signed dmg");
    assert.deepEqual(JSON.parse(fs.readFileSync(published.manifest, "utf8")), manifest);
    assert.deepEqual(fs.readdirSync(out).sort(), ["TechPrep.dmg", "desktop-release-mac.json"]);
    assert.throws(() => release.publish(installer, { ...manifest, sha256: "0".repeat(64) }, out), /does not match/);
    assert.ok(!fs.existsSync(path.join(out, "desktop-release-mac.json")), "a mismatched build must leave no manifest");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
