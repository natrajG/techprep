import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

let openDialogs = 0;
let previousOverflow = "";

export default function Dialog({ children, onClose, label, className = "", style }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement;
    if (openDialogs++ === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    const focusable = () => [...ref.current.querySelectorAll(
      "button:not(:disabled), a[href], input:not(:disabled):not([type=hidden]), textarea:not(:disabled), select:not(:disabled), [tabindex='0']",
    )].filter((node) => node.getClientRects().length);
    (focusable()[0] || ref.current).focus();
    function handleKey(event) {
      const dialogs = document.querySelectorAll(".tp-dialog");
      const checkoutOpen = [...document.querySelectorAll(".razorpay-container")].some((node) => node.getClientRects().length && getComputedStyle(node).visibility !== "hidden");
      if (dialogs[dialogs.length - 1] !== ref.current || checkoutOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current?.();
      }
      if (event.key === "Tab") {
        const nodes = focusable();
        if (!nodes.length) { event.preventDefault(); ref.current.focus(); return; }
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && (document.activeElement === first || !ref.current.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !ref.current.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    }
    document.addEventListener("keydown", handleKey, true);
    return () => {
      document.removeEventListener("keydown", handleKey, true);
      if (--openDialogs === 0) document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  return createPortal(
    <div className="tp-dialog-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        className={`tp-dialog ${className}`} style={style}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
