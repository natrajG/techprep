export function hoverTitle(text, desktop = globalThis.window?.desktop) {
  return desktop ? undefined : text;
}
