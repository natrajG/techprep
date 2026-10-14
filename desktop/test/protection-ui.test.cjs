const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

// Reuse Vite's existing JSX compiler and React renderer; no extra test framework.
const webRequire = createRequire(path.resolve(__dirname, "../../frontend/react-web/package.json"));
const React = webRequire("react");
const { renderToStaticMarkup } = webRequire("react-dom/server");
const { buildSync } = webRequire("esbuild");
const compiled = buildSync({
  entryPoints: [path.resolve(__dirname, "../../frontend/react-web/src/CaptureProtectionSettings.jsx")],
  bundle: true, write: false, format: "cjs", platform: "node", external: ["react"],
}).outputFiles[0].text;
const context = { module: { exports: {} }, require: webRequire };
vm.runInNewContext(compiled, context);
const Settings = context.module.exports.default;

function render(state, props = {}) {
  return renderToStaticMarkup(React.createElement(Settings, {
    state: { supported: true, requested: true, detail: "Platform caveat", ...state },
    pending: false, error: "", onRequest() {}, ...props,
  }));
}

test("enabled UI is checked and describes a request, never verified capture blocking", () => {
  const html = render({ status: "enabled" });
  assert.match(html, /checked=""/);
  assert.doesNotMatch(html, /disabled=""/);
  assert.match(html, /does not prove recordings are blocked/);
  assert.match(html, /aria-describedby="capture-protection-status"/);
});

test("disabled UI is unchecked", () => {
  const html = render({ status: "disabled", requested: false });
  assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /Disabled by you/);
});

test("unsupported UI disables the toggle without claiming success", () => {
  const html = render({ supported: false, status: "unsupported" });
  assert.match(html, /disabled=""/);
  assert.match(html, /No protection was applied/);
  assert.doesNotMatch(html, /Protection requested/);
});

test("native failure preserves the checked preference and shows an alert and retry", () => {
  const html = render({ status: "failed", error: "Native failure" });
  assert.match(html, /checked=""/);
  assert.match(html, /role="alert"/);
  assert.match(html, /Native failure/);
  assert.match(html, /Retry protection request/);
});

test("IPC or storage errors suppress stale success messages", () => {
  const html = render({ status: "enabled" }, { error: "IPC unavailable" });
  assert.match(html, /could not be confirmed/);
  assert.match(html, /IPC unavailable/);
  assert.doesNotMatch(html, /Electron accepted/);
});

test("pending UI disables updates and announces progress", () => {
  const html = render({ status: "disabled" }, { pending: true });
  assert.match(html, /disabled=""/);
  assert.match(html, /Updating capture protection/);
});
