import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSync } from "esbuild";
import { hoverTitle } from "../src/hover-title.mjs";

const require = createRequire(import.meta.url);
function render(name, desktop) {
  const compiled = buildSync({
    entryPoints: [fileURLToPath(new URL(`../src/${name}.jsx`, import.meta.url))],
    bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic",
    external: ["react", "react-dom"],
    define: { "import.meta.env": "{}", "import.meta.url": '""' },
    logLevel: "silent",
  }).outputFiles[0].text;
  const context = {
    module: { exports: {} }, require, console, URL, window: { desktop },
    localStorage: { getItem: () => null },
  };
  vm.runInNewContext(compiled, context);
  return renderToStaticMarkup(React.createElement(context.module.exports.default, {
    desktop, onClose() {}, onSignOut() {}, context: "paid", resume: "", jd: "",
  }));
}

test("hover titles are disabled on every desktop platform but preserved in browsers", () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    assert.equal(hoverTitle("Close", { platform }), undefined);
  }
  assert.equal(hoverTitle("Close", null), "Close");
});

test("desktop popup controls omit title tooltips while keeping accessible close labels", () => {
  for (const [name, label] of [
    ["UserProfileModal", "Close Profile"],
    ["ProfileOnboarding", "Close"],
    ["RatingPopup", "Close"],
  ]) {
    const desktopHtml = render(name, { platform: "win32" });
    assert.doesNotMatch(desktopHtml, / title=/, name);
    assert.ok(desktopHtml.includes(`aria-label="${label}"`), name);
    assert.ok(render(name, null).includes(`title="${label}"`), name);
  }
});

test("desktop download details omit titles only in the desktop app", () => {
  assert.doesNotMatch(render("DesktopDownload", { platform: "win32" }), / title=/);
  assert.match(render("DesktopDownload", null), /title="Free build:/);
});
