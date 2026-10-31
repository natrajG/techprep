// Production macOS release: Developer ID-signed, Apple-notarized installer for a public HTTPS server.
// Publishes TechPrep.dmg and desktop-release-mac.json only after codesign/Gatekeeper/notarization verification succeeds.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validatePublicServerUrl } = require("./server-url");
const manifest = require("./package.json");

const INSTALLER = "TechPrep.dmg";
const RELEASE_MANIFEST = "desktop-release-mac.json";
const OUTPUT = path.join("release", "production-mac", "build");
const PUBLISH = path.join(__dirname, "release", "production-mac", "publish");

function normalizeTeamId(value) {
  const teamId = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(teamId)) {
    throw new Error("TECHPREP_SIGNER_TEAM_ID must be your 10-character Apple Developer Team ID.");
  }
  return teamId;
}

function productionOptions(env, platform = process.platform) {
  if (platform !== "darwin") throw new Error("Production macOS releases must be built and verified on macOS.");
  const serverUrl = validatePublicServerUrl(env.TECHPREP_SERVER_URL);
  const teamId = normalizeTeamId(env.TECHPREP_SIGNER_TEAM_ID);
  if (!env.APPLE_ID || !env.APPLE_APP_SPECIFIC_PASSWORD || !env.APPLE_TEAM_ID) {
    throw new Error("Set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID so electron-builder can notarize the build.");
  }
  if (String(env.APPLE_TEAM_ID).trim().toUpperCase() !== teamId) {
    throw new Error("APPLE_TEAM_ID must match TECHPREP_SIGNER_TEAM_ID.");
  }
  return {
    teamId,
    serverUrl,
    build: {
      projectDir: __dirname,
      mac: ["dmg"],
      publish: "never",
      config: {
        directories: { output: OUTPUT },
        extraMetadata: { techprepServerUrl: serverUrl },
        mac: {
          target: [{ target: "dmg", arch: ["x64"] }],
          hardenedRuntime: true,
          entitlements: "entitlements.mac.plist",
          entitlementsInherit: "entitlements.mac.plist",
        },
        dmg: { artifactName: INSTALLER },
      },
    },
  };
}

function run(command, args, execute = spawnSync) {
  const result = execute(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout || ""}${result.stderr || ""}` };
}

// codesign/spctl write their human-readable details to stderr even on success; both are captured above.
function readSignature(file, execute = spawnSync) {
  const codesign = run("codesign", ["-dvvv", file], execute);
  const authorityMatch = codesign.output.match(/^Authority=(.+)$/m);
  const teamMatch = authorityMatch ? authorityMatch[1].match(/\(([A-Z0-9]{10})\)\s*$/) : null;
  const assess = run("spctl", ["-a", "-t", "exec", "-vv", file], execute);
  return {
    signed: codesign.status === 0,
    authority: authorityMatch ? authorityMatch[1] : null,
    teamId: teamMatch ? teamMatch[1] : null,
    accepted: assess.status === 0 && /:\s*accepted\s*$/m.test(assess.output),
    notarized: /source=Notarized Developer ID/.test(assess.output),
  };
}

function checkSignature(file, signature, teamId) {
  const name = path.basename(file);
  if (!signature.signed) throw new Error(`${name} is not validly code-signed.`);
  if (signature.teamId !== teamId) {
    throw new Error(`${name} was signed by an unexpected Developer ID (team ${signature.teamId || "unknown"}).`);
  }
  if (!signature.accepted) throw new Error(`${name} failed Gatekeeper assessment.`);
  if (!signature.notarized) throw new Error(`${name} is not notarized by Apple.`);
  return { authority: signature.authority, teamId };
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function releaseManifest({ installer, serverUrl, signer, version = manifest.version, now = new Date() }) {
  return {
    schema: 1,
    file: INSTALLER,
    version,
    serverUrl,
    size: fs.statSync(installer).size,
    sha256: sha256(installer),
    signed: true,
    notarized: true,
    signer,
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
  const options = productionOptions(process.env);
  const { build } = require("electron-builder");
  const artifacts = await build(options.build);
  const installer = artifacts.find((file) => path.basename(file) === INSTALLER);
  if (!installer) throw new Error(`The build did not produce ${INSTALLER}; nothing was published.`);
  const app = path.join(__dirname, OUTPUT, "mac", `${manifest.productName}.app`);
  checkSignature(app, readSignature(app), options.teamId);
  const signer = checkSignature(installer, readSignature(installer), options.teamId);
  const release = releaseManifest({ installer, serverUrl: options.serverUrl, signer });
  const published = publish(installer, release);
  console.log(`Verified signed, notarized release ${release.version} (${release.sha256})`);
  console.log(`Upload both files to the server's release directory:\n  ${published.installer}\n  ${published.manifest}`);
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = {
  productionOptions, normalizeTeamId, readSignature, checkSignature, sha256, releaseManifest, publish,
};
