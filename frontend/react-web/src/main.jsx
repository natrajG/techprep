import React from "react";
import { createRoot } from "react-dom/client";
import Root from "./Root";
import "./design-system.css";

if (!window.desktop) document.documentElement.classList.add("tp-browser");

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
