// Production Windows release: signed per-user installer for a public HTTPS server.
// Publishes TechPrep-Setup.exe and desktop-release.json only after Authenticode verification succeeds.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { validatePublicServerUrl } = require("./server-url");
const manifest = require("./package.json");

const INSTALLER = "TechPrep-Setup.exe";
const RELEASE_MANIFEST = "desktop-release.json";
const OUTPUT = path.join("release", "production", "build");
const PUBLISH = path.join(__dirname, "release", "production", "publish");

function normalizeThumbprint(value) {
  const thumbprint = String(value || "").replace(/\s/g, "").toUpperCase();
  if (!/^[0-9A-F]{40}$/.test(thumbprint)) {
    throw new Error("TECHPREP_SIGNER_SHA1 must be the 40-hex-character SHA-1 thumbprint of your code-signing certificate.");
  }
  return thumbprint;
}

function productionOptions(env, platform = process.platform) {
  if (platform !== "win32") throw new Error("Production Windows releases must be built and verified on Windows.");
  const serverUrl = validatePublicServerUrl(env.TECHPREP_SERVER_URL);
  const thumbprint = normalizeThumbprint(env.TECHPREP_SIGNER_SHA1);
  const signtoolOptions = { signingHashAlgorithms: ["sha256"] };
  if (env.TECHPREP_TIMESTAMP_URL) signtoolOptions.rfc3161TimeStampServer = env.TECHPREP_TIMESTAMP_URL;
  // Without CSC_LINK, sign with the certificate in the Windows store (hardware token or cloud-signing KSP).
  if (!env.CSC_LINK && !env.WIN_CSC_LINK) signtoolOptions.certificateSha1 = thumbprint;
  return {
    thumbprint,
    serverUrl,
    build: {
      projectDir: __dirname,
      win: ["nsis"],
      x64: true,
      publish: "never",
      config: {
        directories: { output: OUTPUT },
        extraMetadata: { techprepServerUrl: serverUrl },
        forceCodeSigning: true,
        win: { target: "nsis", signtoolOptions },
        nsis: { artifactName: INSTALLER, oneClick: true, perMachine: false },
      },
    },
  };
}

// PowerShell receives the path through the environment, so file names are never parsed as script.
const SIGNATURE_SCRIPT = [
  "$s = Get-AuthenticodeSignature -LiteralPath $env:TECHPREP_VERIFY_PATH",
  "[pscustomobject]@{",
  "  status = [string]$s.Status",
  "  thumbprint = if ($s.SignerCertificate) { $s.SignerCertificate.Thumbprint } else { $null }",
  "  subject = if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { $null }",
  "  timestamped = [bool]$s.TimeStamperCertificate",
  "} | ConvertTo-Json -Compress",
].join("\n");

function readSignature(file, exec = execFileSync) {
  const output = exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", SIGNATURE_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, TECHPREP_VERIFY_PATH: file },
  });
  return JSON.parse(output);
}

function checkSignature(file, signature, thumbprint) {
  const name = path.basename(file);
  if (signature.status !== "Valid") throw new Error(`${name} signature is ${signature.status || "missing"}, not Valid.`);
  if (String(signature.thumbprint || "").toUpperCase() !== thumbprint) {
    throw new Error(`${name} was signed by an unexpected certificate.`);
  }
  if (signature.timestamped !== true) throw new Error(`${name} signature has no trusted timestamp.`);
  return { subject: signature.subject, thumbprint };
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
  const app = path.join(__dirname, OUTPUT, "win-unpacked", `${manifest.productName}.exe`);
  checkSignature(app, readSignature(app), options.thumbprint);
  const signer = checkSignature(installer, readSignature(installer), options.thumbprint);
  const release = releaseManifest({ installer, serverUrl: options.serverUrl, signer });
  const published = publish(installer, release);
  console.log(`Verified signed release ${release.version} (${release.sha256})`);
  console.log(`Upload both files to the server's release directory:\n  ${published.installer}\n  ${published.manifest}`);
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { productionOptions, readSignature, checkSignature, releaseManifest, publish, normalizeThumbprint };
