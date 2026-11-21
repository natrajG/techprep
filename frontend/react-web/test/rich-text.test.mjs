import { test } from "node:test";
import assert from "node:assert/strict";
import { answerBlocks, splitBold } from "../src/rich-text.mjs";

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

test("groups bullet points and wrapped lines without changing their content", () => {
  assert.deepEqual(answerBlocks("- **Queue:** Enqueue jobs.\n  Keep the request fast.\n- Retry failures."), [
    { type: "points", items: ["**Queue:** Enqueue jobs.\n  Keep the request fast.", "Retry failures."] },
  ]);
  assert.deepEqual(answerBlocks("1. First\n2) Second"), [
    { type: "points", items: ["First", "Second"] },
  ]);
});

test("code blocks preserve indentation, operators and list-looking code", () => {
  assert.deepEqual(answerBlocks("```python\ndef square(x):\n    return x ** 2\n- not_a_bullet\n```"), [
    { type: "code", language: "python", lines: ["def square(x):", "    return x ** 2", "- not_a_bullet"] },
  ]);
});

test("an unfinished streaming code fence stays code and old prose stays prose", () => {
  assert.deepEqual(answerBlocks("```js\nconst value ="), [
    { type: "code", language: "js", lines: ["const value ="] },
  ]);
  assert.deepEqual(answerBlocks("A previous answer.\nStill the same paragraph.\n\nAnother paragraph."), [
    { type: "paragraph", lines: ["A previous answer.", "Still the same paragraph."] },
    { type: "paragraph", lines: ["Another paragraph."] },
  ]);
});
