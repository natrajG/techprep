const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { validatePublicServerUrl } = require("../server-url");
const release = require("../build-windows-production.cjs");

const THUMBPRINT = "A".repeat(40);
const env = { TECHPREP_SERVER_URL: "https://techprep-demo.duckdns.org", TECHPREP_SIGNER_SHA1: "aa ".repeat(20) };

test("public server URL accepts DNS names and rejects LAN, IP, local and custom-port URLs", () => {
  assert.equal(validatePublicServerUrl("https://techprep-demo.duckdns.org"), "https://techprep-demo.duckdns.org/");
  for (const value of [
    "https://192.168.0.109:5173/", "https://192.168.0.109/", "https://10.0.0.1/", "https://[::1]/",
    "https://localhost/", "https://server/", "https://app.local/", "https://box.lan/", "https://a.internal/",
    "https://site.example/", "https://techprep.duckdns.org:5173/", "http://techprep.duckdns.org/",
    "https://techprep.duckdns.org/path", "https://u:p@techprep.duckdns.org/", "",
  ]) {
    assert.throws(() => validatePublicServerUrl(value), /HTTPS|public DNS/, value);
  }
});

test("production options require Windows, a public URL, and the signer thumbprint", () => {
  assert.throws(() => release.productionOptions(env, "linux"), /on Windows/);
  assert.throws(() => release.productionOptions({ ...env, TECHPREP_SERVER_URL: "https://192.168.0.109:5173/" }, "win32"), /public DNS/);
  assert.throws(() => release.productionOptions({ ...env, TECHPREP_SERVER_URL: undefined }, "win32"), /HTTPS/);
  for (const bad of [undefined, "", "abc", "G".repeat(40), "A".repeat(39)]) {
    assert.throws(() => release.productionOptions({ ...env, TECHPREP_SIGNER_SHA1: bad }, "win32"), /thumbprint/);
  }
});

test("production build forces signing, per-user installation and never publishes from electron-builder", () => {
  const options = release.productionOptions(env, "win32");
  assert.equal(options.thumbprint, THUMBPRINT);
  const { config } = options.build;
  assert.equal(config.forceCodeSigning, true);
  assert.equal(config.extraMetadata.techprepServerUrl, "https://techprep-demo.duckdns.org/");
  assert.deepEqual(config.nsis, { artifactName: "TechPrep-Setup.exe", oneClick: true, perMachine: false });
  assert.deepEqual(config.win.signtoolOptions, { signingHashAlgorithms: ["sha256"], certificateSha1: THUMBPRINT });
  assert.equal(options.build.publish, "never");
  assert.match(config.directories.output, /production/);
  assert.doesNotMatch(config.directories.output, /^release$/);
});

test("certificate file signing does not also pin a store certificate; custom timestamp server is honored", () => {
  const options = release.productionOptions({ ...env, CSC_LINK: "file.pfx", TECHPREP_TIMESTAMP_URL: "http://ts.example" }, "win32");
  assert.deepEqual(options.build.config.win.signtoolOptions, {
    signingHashAlgorithms: ["sha256"], rfc3161TimeStampServer: "http://ts.example",
  });
});

test("signature verification requires Valid status, the expected signer, and a timestamp", () => {
  const good = { status: "Valid", thumbprint: THUMBPRINT.toLowerCase(), subject: "CN=TechPrep", timestamped: true };
  assert.deepEqual(release.checkSignature("C:/a/TechPrep.exe", good, THUMBPRINT), { subject: "CN=TechPrep", thumbprint: THUMBPRINT });
  for (const [change, message] of [
    [{ status: "NotSigned" }, /NotSigned/],
    [{ status: "HashMismatch" }, /HashMismatch/],
    [{ status: "UnknownError" }, /UnknownError/],
    [{ status: undefined }, /missing/],
    [{ thumbprint: "B".repeat(40) }, /unexpected certificate/],
    [{ thumbprint: null }, /unexpected certificate/],
    [{ timestamped: false }, /timestamp/],
  ]) {
    assert.throws(() => release.checkSignature("TechPrep-Setup.exe", { ...good, ...change }, THUMBPRINT), message);
  }
});

test("signature is read through PowerShell with the path passed as data, not script", () => {
  let call;
  const exec = (command, args, options) => {
    call = { command, args, options };
    return '{"status":"Valid","thumbprint":"X","subject":"CN=T","timestamped":true}';
  };
  const file = "C:/out/$(evil); TechPrep.exe";
  assert.equal(release.readSignature(file, exec).status, "Valid");
  assert.equal(call.command, "powershell.exe");
  assert.ok(!call.args.join(" ").includes(file));
  assert.equal(call.options.env.TECHPREP_VERIFY_PATH, file);
  assert.match(call.args.at(-1), /Get-AuthenticodeSignature -LiteralPath \$env:TECHPREP_VERIFY_PATH/);
});

test("manifest and publish produce a matching installer/manifest pair, replacing an old release", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "techprep-release-"));
  try {
    const installer = path.join(dir, "built.exe");
    fs.writeFileSync(installer, "MZ signed");
    const signer = { subject: "CN=TechPrep", thumbprint: THUMBPRINT };
    const manifest = release.releaseManifest({
      installer, serverUrl: "https://techprep-demo.duckdns.org/", signer, version: "1.2.3", now: new Date(0),
    });
    assert.deepEqual(manifest, {
      schema: 1, file: "TechPrep-Setup.exe", version: "1.2.3", serverUrl: "https://techprep-demo.duckdns.org/",
      size: 9, sha256: crypto.createHash("sha256").update("MZ signed").digest("hex"),
      signed: true, signer, builtAt: "1970-01-01T00:00:00.000Z",
    });
    const out = path.join(dir, "publish");
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, "desktop-release.json"), "{\"old\":true}");
    fs.writeFileSync(path.join(out, "TechPrep-Setup.exe"), "old installer");
    const published = release.publish(installer, manifest, out);
    assert.equal(fs.readFileSync(published.installer, "utf8"), "MZ signed");
    assert.deepEqual(JSON.parse(fs.readFileSync(published.manifest, "utf8")), manifest);
    assert.deepEqual(fs.readdirSync(out).sort(), ["TechPrep-Setup.exe", "desktop-release.json"]);
    assert.throws(() => release.publish(installer, { ...manifest, sha256: "0".repeat(64) }, out), /does not match/);
    assert.ok(!fs.existsSync(path.join(out, "desktop-release.json")), "a mismatched build must leave no manifest");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
