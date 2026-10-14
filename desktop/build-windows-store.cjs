// Store-only AppX package. Microsoft signs it after certification; it is not a signed web installer.
const path = require("node:path");
const { validatePublicServerUrl } = require("./server-url");

const STORE_IDENTITY = {
  identityName: "NatrajG.TechPrep",
  publisher: "CN=97ACEC83-5AB4-4DE7-B316-690EEA92CAF5",
  publisherDisplayName: "NatrajG",
};

function storeOptions(env, platform = process.platform) {
  if (platform !== "win32") throw new Error("Store AppX packages must be built on Windows.");
  if (env.CSC_LINK || env.WIN_CSC_LINK || env.WIN_CSC_KEY_PASSWORD || env.CSC_KEY_PASSWORD) {
    throw new Error("Unset code-signing credentials for the unsigned Store build.");
  }
  const serverUrl = validatePublicServerUrl(env.TECHPREP_SERVER_URL);
  return {
    projectDir: __dirname,
    win: ["appx"],
    x64: true,
    publish: "never",
    config: {
      directories: { output: "release/store" },
      extraMetadata: { techprepServerUrl: serverUrl },
      win: { target: "appx", signExecutable: false },
      appx: {
        ...STORE_IDENTITY,
        applicationId: "TechPrep",
        displayName: "TechPrep",
        artifactName: "TechPrep-Store-${version}-${arch}.${ext}",
        minVersion: "10.0.19041.0",
        languages: ["en-US"],
        capabilities: ["internetClient"],
      },
    },
  };
}

async function main() {
  const options = storeOptions(process.env);
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  const { build } = require("electron-builder");
  const artifacts = await build(options);
  const appx = artifacts.find((file) => path.extname(file).toLowerCase() === ".appx");
  if (!appx) throw new Error("No Store AppX package was produced.");
  console.log(`Store package ready for Partner Center Packages: ${appx}`);
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { storeOptions, STORE_IDENTITY };
