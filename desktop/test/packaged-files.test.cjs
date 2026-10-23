const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const manifest = require("../package.json");

// A file that main.js or preload.js loads but electron-builder does not package crashes the installed app on launch.
test("every local module the shell loads is listed in the packaged files", () => {
  const root = path.resolve(__dirname, "..");
  const queue = ["main.js", "preload.js"];
  const seen = new Set();
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of source.matchAll(/require\(["'](\.\/[^"']+)["']\)/g)) {
      const name = match[1].slice(2);
      queue.push(path.extname(name) ? name : `${name}.js`);
    }
  }
  for (const file of seen) {
    assert.ok(manifest.build.files.includes(file), `${file} is loaded by the shell but not packaged`);
  }
  assert.ok(seen.has("logger.js"), "the dependency scan must reach logger.js");
});
