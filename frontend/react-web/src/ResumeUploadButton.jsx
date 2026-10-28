import { useRef, useState } from "react";
import { extractPdfText } from "./resume-pdf.mjs";

// A small "Upload PDF (optional)" control that extracts resume text client-side and hands it to
// the caller — the file itself is never sent to the server or stored anywhere.
export default function ResumeUploadButton({ onExtracted, style, buttonStyle }) {
  const inputRef = useRef(null);
  const [status, setStatus] = useState(""); // "" | "extracting" | "error"
  const [error, setError] = useState("");

  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setStatus("extracting");
    setError("");
    try {
      const text = await extractPdfText(file);
      onExtracted(text);
      setStatus("");
    } catch (e) {
      setStatus("error");
      setError(e.message);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={handleFile} />
      <button
        type="button"
        style={{ ...defaultButtonStyle, ...buttonStyle }}
        onClick={() => inputRef.current?.click()}
        disabled={status === "extracting"}
      >
        {status === "extracting" ? "Extracting…" : "📄 Upload resume PDF (optional)"}
      </button>
      {error && <span style={{ color: "#fca5a5", fontSize: 11 }}>{error}</span>}
    </div>
  );
}

const defaultButtonStyle = {
  alignSelf: "flex-start",
  background: "rgba(56, 189, 248, 0.12)",
  border: "1px solid rgba(56, 189, 248, 0.3)",
  color: "#38bdf8",
  padding: "6px 12px",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
