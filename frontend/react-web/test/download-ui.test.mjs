import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSync } from "esbuild";

const require = createRequire(import.meta.url);
const compiled = buildSync({
  entryPoints: [fileURLToPath(new URL("../src/DesktopDownload.jsx", import.meta.url))],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react"],
  define: { "import.meta.env.VITE_API_URL": '""' },
}).outputFiles[0].text;
const context = { module: { exports: {} }, require };
vm.runInNewContext(compiled, context);

test("download panel includes Windows installer and trusted CA setup instructions", () => {
  const html = renderToStaticMarkup(React.createElement(context.module.exports.default));
  assert.match(html, /Download Windows app/);
  assert.match(html, /Windows 10\/11 \(64-bit\)/);
  assert.match(html, /Sign in again in the app/);
  assert.match(html, /Download local CA certificate/);
  assert.match(html, /Trusted Root Certification Authorities/);
  assert.doesNotMatch(html, /disabled=""/);
});

test("download panel always offers the notarized Mac installer, regardless of Windows Store state", () => {
  for (const props of [{}, { localNetwork: false }, { localNetwork: false, storeUrl: "https://apps.microsoft.com/detail/9N36X6C5706B" }]) {
    const html = renderToStaticMarkup(React.createElement(context.module.exports.default, props));
    assert.match(html, /Download Mac app/);
    assert.match(html, /macOS 13 \(Ventura\) or later/);
  }
});

test("unpublished Store app does not offer a broken installer or listing link", () => {
  const html = renderToStaticMarkup(React.createElement(context.module.exports.default, { localNetwork: false }));
  assert.match(html, /Microsoft Store release coming soon/);
  assert.doesNotMatch(html, /Download Windows app|href="https:\/\/apps\.microsoft\.com/);
  assert.doesNotMatch(html, /CA certificate|Trusted Root|same network/);
});

test("published Store app links to Microsoft Store instead of serving an installer", () => {
  const html = renderToStaticMarkup(React.createElement(context.module.exports.default, {
    localNetwork: false, storeUrl: "https://apps.microsoft.com/detail/9N36X6C5706B",
  }));
  assert.match(html, /Install from Microsoft Store/);
  assert.match(html, /href="https:\/\/apps\.microsoft\.com\/detail\/9N36X6C5706B"/);
  assert.doesNotMatch(html, /Download Windows app|CA certificate/);
});
