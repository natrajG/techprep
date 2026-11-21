const FILLER_WORDS = new Set([
  "thanks", "thank", "you", "ok", "okay", "yes", "no", "yeah", "yep",
  "sure", "alright", "cool", "right", "got", "it", "mm", "uh", "um", "hmm",
  "fine", "understood", "understand", "please", "sir",
]);

export function isAcknowledgement(text, candidate = "") {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  // Only known account-name parts may be stripped; never guess that an unfamiliar technical word is a name.
  const names = new Set(String(candidate ?? "").toLowerCase().split("@")[0].match(/[a-z]+/g) || []);
  return words.some((word) => FILLER_WORDS.has(word)) &&
    words.every((word) => FILLER_WORDS.has(word) || names.has(word));
}
