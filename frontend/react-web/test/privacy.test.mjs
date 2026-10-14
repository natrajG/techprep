import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSync } from "esbuild";

const require = createRequire(import.meta.url);

test("privacy policy is a public static page linked from sign-in", () => {
  const policy = readFileSync(new URL("../public/privacy/index.html", import.meta.url), "utf8");
  assert.match(policy, /TechPrep Privacy Policy/);
  assert.match(policy, /OpenAI/);
  assert.match(policy, /mailto:natraj22varma2@gmail.com/);

  const compiled = buildSync({
    entryPoints: [fileURLToPath(new URL("../src/Login.jsx", import.meta.url))],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    external: ["react"],
  }).outputFiles[0].text;
  const context = { module: { exports: {} }, require };
  vm.runInNewContext(compiled, context);
  const html = renderToStaticMarkup(React.createElement(context.module.exports.default, { onSubmit() {} }));
  assert.match(html, /href="\/privacy\/"/);
});
