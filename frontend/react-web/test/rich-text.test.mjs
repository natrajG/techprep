import { test } from "node:test";
import assert from "node:assert/strict";
import { splitBold } from "../src/rich-text.mjs";

test("bold markers become bold segments and the markers are removed", () => {
  assert.deepEqual(splitBold("**Situation:** We shipped."), [
    { bold: true, text: "Situation:" },
    { bold: false, text: " We shipped." },
  ]);
});

test("plain text and unfinished streaming markers are left unchanged", () => {
  assert.deepEqual(splitBold("No formatting"), [{ bold: false, text: "No formatting" }]);
  assert.deepEqual(splitBold("**Sit"), [{ bold: false, text: "**Sit" }]);
  assert.deepEqual(splitBold(""), []);
});
