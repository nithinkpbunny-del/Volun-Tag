import { useCallback, useState } from "react";
import "./Toast.css";

export default function Toast({ msg, type, visible }) {
  return (
    <div className={`toast-notification ${type} ${visible ? "show" : ""}`} role="alert">
      <span className="toast-icon">
        {type === "success" ? "✓" : type === "error" ? "✕" : "ℹ"}
      </span>
      <span className="toast-msg">{msg}</span>
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState({ msg: "", type: "success", visible: false });

  // Stable identity: screens list showToast in effect dependencies, so a new
  // function on every render would re-run those effects after each toast
  // (the dashboards reloaded their profile, and Settings lost its state).
  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type, visible: true });
    setTimeout(() => setToast((prev) => ({ ...prev, visible: false })), 3500);
  }, []);

  return { toast, showToast };
}
