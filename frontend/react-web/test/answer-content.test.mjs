import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSync } from "esbuild";

const require = createRequire(import.meta.url);
const compiled = buildSync({
  entryPoints: [fileURLToPath(new URL("../src/AnswerContent.jsx", import.meta.url))],
  bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic",
  external: ["react", "react-dom"],
}).outputFiles[0].text;
const context = { module: { exports: {} }, require };
vm.runInNewContext(compiled, context);
const render = (text) => renderToStaticMarkup(React.createElement(context.module.exports.default, { text }));

test("answers render as semantic points with bold lead-ins", () => {
  const html = render("- **Enqueue:** Store the job.\n- **Retry:** Use backoff.");
  assert.match(html, /<ul class="hud-answer-points"><li><strong>Enqueue:<\/strong>/);
  assert.equal((html.match(/<li>/g) || []).length, 2);
  assert.doesNotMatch(html, /<pre>/);
  assert.doesNotMatch(html, /<ol/);
});

test("numbered provider output also displays as bullets", () => {
  const html = render("1. Enqueue jobs.\n2. Retry failures.");
  assert.match(html, /<ul class="hud-answer-points"><li>Enqueue jobs\.<\/li><li>Retry failures\.<\/li><\/ul>/);
  assert.doesNotMatch(html, /<ol|1\.|2\./);
});

test("code remains literal and provider HTML cannot create DOM elements", () => {
  const html = render('```python\nreturn x ** 2\n```\n\n- <img src=x onerror=alert(1)>');
  assert.match(html, /<code>return x \*\* 2<\/code>/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img|<script/);
});
