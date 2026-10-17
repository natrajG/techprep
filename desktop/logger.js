// Minimal file-based logger for the packaged app, where there is no visible console window.
// Writes to <userData>/logs/techprep.log, rotating to a single .old backup once it grows too large.
const fs = require("fs");
const path = require("path");

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

function createLogger(userDataDir) {
  const dir = path.join(userDataDir, "logs");
  const file = path.join(dir, "techprep.log");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // If the log directory cannot be created, logging degrades to console-only below.
  }

  function rotateIfNeeded() {
    try {
      const { size } = fs.statSync(file);
      if (size > MAX_BYTES) fs.renameSync(file, `${file}.old`);
    } catch {
      // No existing file yet; nothing to rotate.
    }
  }

  function write(level, ...parts) {
    const line = `[${new Date().toISOString()}] [${level}] ${parts.map((p) =>
      p instanceof Error ? (p.stack || p.message) : typeof p === "string" ? p : JSON.stringify(p)
    ).join(" ")}\n`;
    try {
      rotateIfNeeded();
      fs.appendFileSync(file, line);
    } catch {
      // Logging must never crash the app; fall through to console only.
    }
    (level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log)(...parts);
  }

  return {
    path: file,
    info: (...parts) => write("INFO", ...parts),
    warn: (...parts) => write("WARN", ...parts),
    error: (...parts) => write("ERROR", ...parts),
  };
}

module.exports = { createLogger };
