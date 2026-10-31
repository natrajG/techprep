// Free-tier macOS release: an UNSIGNED, un-notarized installer for a public HTTPS server.
// Use this only until an Apple Developer Program account ($99/yr) is affordable; see
// docs/desktop-capture-protection.md for the Gatekeeper bypass steps end users must follow.
// Publishes the same TechPrep.dmg / desktop-release-mac.json files as build-mac-production.cjs,
// but with signed:false and notarized:false, and skips codesign/notarization entirely.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { validatePublicServerUrl } = require("./server-url");
const manifest = require("./package.json");

const INSTALLER = "TechPrep.dmg";
const RELEASE_MANIFEST = "desktop-release-mac.json";
const OUTPUT = path.join("release", "production-mac", "build");
const PUBLISH = path.join(__dirname, "release", "production-mac", "publish");

function unsignedOptions(env, platform = process.platform) {
  if (platform !== "darwin") throw new Error("macOS releases must be built on macOS, even when unsigned.");
  const serverUrl = validatePublicServerUrl(env.TECHPREP_SERVER_URL);
  return {
    serverUrl,
    build: {
      projectDir: __dirname,
      mac: ["dmg"],
      publish: "never",
      config: {
        directories: { output: OUTPUT },
        extraMetadata: { techprepServerUrl: serverUrl },
        // No hardenedRuntime/entitlements/identity: an ad-hoc or absent signature is expected.
        mac: { target: [{ target: "dmg", arch: ["x64"] }], identity: null },
        dmg: { artifactName: INSTALLER },
      },
    },
  };
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function releaseManifest({ installer, serverUrl, version = manifest.version, now = new Date() }) {
  return {
    schema: 1,
    file: INSTALLER,
    version,
    serverUrl,
    size: fs.statSync(installer).size,
    sha256: sha256(installer),
    signed: false,
    notarized: false,
    builtAt: now.toISOString(),
  };
}

function publish(installer, release, destination = PUBLISH) {
  fs.mkdirSync(destination, { recursive: true });
  const target = path.join(destination, INSTALLER);
  const manifestPath = path.join(destination, RELEASE_MANIFEST);
  // Withdraw the old manifest first so the server never pairs it with a different installer.
  fs.rmSync(manifestPath, { force: true });
  fs.copyFileSync(installer, `${target}.pending`);
  fs.renameSync(`${target}.pending`, target);
  if (sha256(target) !== release.sha256) throw new Error("Published installer does not match the verified build.");
  fs.writeFileSync(`${manifestPath}.pending`, `${JSON.stringify(release, null, 2)}\n`);
  fs.renameSync(`${manifestPath}.pending`, manifestPath);
  return { installer: target, manifest: manifestPath };
}

async function main() {
  const options = unsignedOptions(process.env);
  const { build } = require("electron-builder");
  const artifacts = await build(options.build);
  const installer = artifacts.find((file) => path.basename(file) === INSTALLER);
  if (!installer) throw new Error(`The build did not produce ${INSTALLER}; nothing was published.`);
  const release = releaseManifest({ installer, serverUrl: options.serverUrl });
  const published = publish(installer, release);
  console.log(`Published UNSIGNED release ${release.version} (${release.sha256}).`);
  console.log("Users will see a Gatekeeper warning on first launch; see docs/desktop-capture-protection.md.");
  console.log(`Upload both files to the server's release directory:\n  ${published.installer}\n  ${published.manifest}`);
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { unsignedOptions, sha256, releaseManifest, publish };
