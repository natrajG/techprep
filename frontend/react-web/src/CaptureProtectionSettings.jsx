import React from "react";
import { captureStatusMessage } from "./capture-protection.mjs";

export default function CaptureProtectionSettings({ state, pending, error, onRequest, cardStyle, rowStyle, buttonStyle }) {
  return (
    <section style={{ ...cardStyle, fontSize: 12 }}>
      <label style={rowStyle}>
        <input type="checkbox" checked={state.requested}
          disabled={pending || !state.supported}
          aria-describedby="capture-protection-status"
          onChange={(event) => onRequest(event.target.checked)} />
        Hide from screen capture (best effort)
      </label>
      <p id="capture-protection-status" role={state.status === "failed" ? "alert" : "status"} style={{ margin: "6px 0 0" }}>
        {pending ? "Updating capture protection..." : error
          ? "Capture-protection status could not be confirmed. Do not rely on capture exclusion."
          : captureStatusMessage(state)}
      </p>
      {(state.status === "failed" || error) && state.supported && (
        <button style={buttonStyle} disabled={pending}
          onClick={() => onRequest(state.requested)}>Retry protection request</button>
      )}
      {error && <p role="alert" style={{ color: "#b91c1c", margin: "6px 0 0" }}>{error}</p>}
    </section>
  );
}
