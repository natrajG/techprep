const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { STORE_IDENTITY, storeOptions } = require("../build-windows-store.cjs");

const serverUrl = "https://13-201-213-33.sslip.io/";

test("Store build uses the reserved identity, public site, and an unsigned AppX target", () => {
  const options = storeOptions({ TECHPREP_SERVER_URL: serverUrl }, "win32");
  assert.equal(options.projectDir, path.resolve(__dirname, ".."));
  assert.deepEqual(options.win, ["appx"]);
  assert.equal(options.x64, true);
  assert.equal(options.publish, "never");
  assert.equal(options.config.directories.output, "release/store");
  assert.equal(options.config.extraMetadata.techprepServerUrl, serverUrl);
  assert.deepEqual(options.config.win, { target: "appx", signExecutable: false });
  assert.deepEqual(options.config.appx, {
    ...STORE_IDENTITY,
    applicationId: "TechPrep",
    displayName: "TechPrep",
    artifactName: "TechPrep-Store-${version}-${arch}.${ext}",
    minVersion: "10.0.19041.0",
    languages: ["en-US"],
    capabilities: ["internetClient"],
    backgroundColor: "#0f172a",
  });
  assert.deepEqual(STORE_IDENTITY, {
    identityName: "NatrajG.TechPrep",
    publisher: "CN=97ACEC83-5AB4-4DE7-B316-690EEA92CAF5",
    publisherDisplayName: "NatrajG",
  });
});

test("Store package has TechPrep tile assets and an executable icon", () => {
  const projectDir = path.resolve(__dirname, "..");
  const build = require("../package.json").build;
  assert.equal(build.win.icon, "build/icon.ico");
  for (const [name, width, height] of [
    ["StoreLogo.png", 50, 50],
    ["Square150x150Logo.png", 150, 150],
    ["Square44x44Logo.png", 44, 44],
    ["Wide310x150Logo.png", 310, 150],
  ]) {
    const png = readFileSync(path.join(projectDir, "build", "appx", name));
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(png.readUInt32BE(16), width, name);
    assert.equal(png.readUInt32BE(20), height, name);
  }
  const ico = readFileSync(path.join(projectDir, build.win.icon));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.ok(ico.readUInt16LE(4) > 0);
});

test("Store build rejects unsupported hosts, nonpublic URLs and signing credentials", () => {
  assert.throws(() => storeOptions({ TECHPREP_SERVER_URL: serverUrl }, "linux"), /on Windows/);
  for (const url of [undefined, "http://13-201-213-33.sslip.io/", "https://127.0.0.1/"]) {
    assert.throws(() => storeOptions({ TECHPREP_SERVER_URL: url }, "win32"), /HTTPS|public DNS/);
  }
  for (const key of ["CSC_LINK", "WIN_CSC_LINK", "CSC_KEY_PASSWORD", "WIN_CSC_KEY_PASSWORD"]) {
    assert.throws(() => storeOptions({ TECHPREP_SERVER_URL: serverUrl, [key]: "value" }, "win32"), /Unset code-signing/);
  }
});
