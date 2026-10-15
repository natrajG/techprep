// Answers arrive as lightly formatted markdown; only **bold** is rendered, everything else stays plain text.
export function splitBold(text) {
  return String(text).split(/(\*\*[^*\n]+\*\*)/g).filter(Boolean).map((part) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4
      ? { bold: true, text: part.slice(2, -2) }
      : { bold: false, text: part });
}
