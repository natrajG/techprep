const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateServerUrl, resolveAppUrl } = require("../server-url");
const { buildOptions } = require("../build-windows.cjs");
const manifest = require("../package.json");

test("build defaults embed the LAN URL and create an x64 NSIS installer without publishing", () => {
  const options = buildOptions([], {});
  assert.equal(options.config.extraMetadata.techprepServerUrl, "https://192.168.0.109:5173/");
  assert.deepEqual(options.win, ["nsis"]);
  assert.equal(options.x64, true);
  assert.equal(options.publish, "never");
  assert.equal(manifest.build.nsis.artifactName, "TechPrep-Setup.exe");
  assert.ok(manifest.build.files.includes("server-url.js"));
  assert.match(manifest.devDependencies.electron, /^\d+\.\d+\.\d+$/, "Electron must be pinned exactly");
  assert.ok(Number(manifest.devDependencies.electron.split(".")[0]) >= 44);
});

test("build URL override is normalized and does not change source metadata", () => {
  const options = buildOptions(["--dir"], {
    TECHPREP_SERVER_URL: "https://server.example:5173",
    TECHPREP_BUILD_OUTPUT: "release/custom-build",
  });
  assert.equal(options.config.extraMetadata.techprepServerUrl, "https://server.example:5173/");
  assert.equal(manifest.build.extraMetadata.techprepServerUrl, "https://192.168.0.109:5173/");
  assert.deepEqual(options.win, ["dir"]);
  assert.equal(options.config.directories.output, "release/custom-build");
  assert.throws(() => buildOptions(["--unknown"], {}), /Usage/);
});

test("build validation rejects insecure URLs and credential-bearing or non-root URLs", () => {
  for (const value of [undefined, "", "not a URL", "http://server/", "file:///app", "https://user:password@server/",
    "https://server/?token=secret", "https://server/#token", "https://server/path"]) {
    assert.throws(() => validateServerUrl(value), /HTTPS/);
    if (value !== undefined) {
      assert.throws(() => buildOptions([], { TECHPREP_SERVER_URL: value }), /HTTPS/);
    }
  }
});

test("source keeps its local defaults, installed builds require valid metadata, and APP_URL wins", () => {
  const metadata = { techprepServerUrl: "https://192.168.0.109:5173/" };
  assert.equal(resolveAppUrl({ isPackaged: false, env: {}, metadata }), "http://127.0.0.1:8000/");
  assert.equal(resolveAppUrl({ isPackaged: false, env: { PORT: "8080" }, metadata }), "http://127.0.0.1:8080/");
  assert.equal(resolveAppUrl({ isPackaged: true, env: {}, metadata }), metadata.techprepServerUrl);
  assert.equal(resolveAppUrl({ isPackaged: true, env: { APP_URL: "http://127.0.0.1:9000/" }, metadata }),
    "http://127.0.0.1:9000/");
  assert.throws(() => resolveAppUrl({ isPackaged: true, env: {}, metadata: {} }), /HTTPS/);
});
