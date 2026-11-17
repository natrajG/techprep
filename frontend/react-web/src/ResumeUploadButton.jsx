import { useRef, useState } from "react";
import { extractPdfText } from "./resume-pdf.mjs";

// A small "Upload PDF (optional)" control that extracts resume text client-side and hands it to
// the caller — the file itself is never sent to the server or stored anywhere.
export default function ResumeUploadButton({ onExtracted, style, buttonStyle, label = "📄 Upload Resume PDF (Required for ATS)", children }) {
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
      localStorage.setItem("resume_uploaded_at", String(Date.now()));
      onExtracted(text);
      setStatus("");
    } catch (e) {
      setStatus("error");
      setError(e.message);
    }
  }

  const triggerUpload = () => inputRef.current?.click();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={handleFile} />
      {children ? (
        children(status, error, triggerUpload)
      ) : (
        <button
          type="button"
          style={{ ...defaultButtonStyle, ...buttonStyle }}
          onClick={triggerUpload}
          disabled={status === "extracting"}
        >
          {status === "extracting" ? "Extracting text from PDF…" : label}
        </button>
      )}
      {error && <span role="alert" style={{ color: "#fca5a5", fontSize: 12 }}>{error}</span>}
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
