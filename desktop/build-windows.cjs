const fs = require("node:fs/promises");
const path = require("node:path");
const { validateServerUrl } = require("./server-url");
const manifest = require("./package.json");

function buildOptions(args, env) {
  if (args.some((arg) => arg !== "--dir")) {
    throw new Error("Usage: node build-windows.cjs [--dir]");
  }
  const serverUrl = validateServerUrl(env.TECHPREP_SERVER_URL ?? manifest.build.extraMetadata.techprepServerUrl);
  return {
    projectDir: __dirname,
    win: args.includes("--dir") ? ["dir"] : ["nsis"],
    x64: true,
    publish: "never",
    config: {
      directories: { output: env.TECHPREP_BUILD_OUTPUT || "release/windows-installer" },
      extraMetadata: { techprepServerUrl: serverUrl },
    },
  };
}

async function main() {
  const options = buildOptions(process.argv.slice(2), process.env);
  const { build } = require("electron-builder");
  const artifacts = await build(options);
  if (!options.win.includes("nsis")) return;
  const installer = artifacts.find((file) => path.basename(file) === "TechPrep-Setup.exe");
  if (!installer) throw new Error("The build did not produce TechPrep-Setup.exe; nothing was published.");
  const destination = path.join(__dirname, "release", "TechPrep-Setup.exe");
  // Publish only a completed build, without exposing a partially copied download.
  await fs.copyFile(installer, `${destination}.pending`);
  await fs.rename(`${destination}.pending`, destination);
  console.log(`Installer ready: ${destination}`);
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { buildOptions };
