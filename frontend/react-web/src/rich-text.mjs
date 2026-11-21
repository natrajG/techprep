// Render only the supported markdown subset; HTML always remains plain text.
export function splitBold(text) {
  return String(text).split(/(\*\*[^*\n]+\*\*)/g).filter(Boolean).map((part) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4
      ? { bold: true, text: part.slice(2, -2) }
      : { bold: false, text: part });
}

export function answerBlocks(text) {
  const blocks = [];
  let current = null;
  let code = null;
  for (const line of String(text).split("\n")) {
    if (code) {
      if (/^\s*```\s*$/.test(line)) {
        code = null;
      } else {
        code.lines.push(line);
      }
      continue;
    }
    const fence = line.match(/^\s*```([\w+-]*)\s*$/);
    if (fence) {
      code = { type: "code", language: fence[1], lines: [] };
      blocks.push(code);
      current = null;
      continue;
    }
    if (!line.trim()) {
      current = null;
      continue;
    }
    const point = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)$/);
    if (point) {
      if (current?.type !== "points") {
        current = { type: "points", items: [] };
        blocks.push(current);
      }
      current.items.push(point[1]);
    } else if (current?.type === "points") {
      current.items[current.items.length - 1] += "\n" + line;
    } else {
      if (current?.type !== "paragraph") {
        current = { type: "paragraph", lines: [] };
        blocks.push(current);
      }
      current.lines.push(line);
    }
  }
  return blocks;
}
