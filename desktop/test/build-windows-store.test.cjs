const { test } = require("node:test");
const assert = require("node:assert/strict");
const { STORE_IDENTITY, storeOptions } = require("../build-windows-store.cjs");

const serverUrl = "https://13-201-213-33.sslip.io/";

test("Store build uses the reserved identity, public site, and an unsigned AppX target", () => {
  const options = storeOptions({ TECHPREP_SERVER_URL: serverUrl }, "win32");
  assert.equal(options.projectDir, require("node:path").resolve(__dirname, ".."));
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
  });
  assert.deepEqual(STORE_IDENTITY, {
    identityName: "NatrajG.TechPrep",
    publisher: "CN=97ACEC83-5AB4-4DE7-B316-690EEA92CAF5",
    publisherDisplayName: "NatrajG",
  });
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
