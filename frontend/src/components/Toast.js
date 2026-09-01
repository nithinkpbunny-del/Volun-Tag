import { useState } from "react";
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

  const showToast = (msg, type = "success") => {
    setToast({ msg, type, visible: true });
    setTimeout(() => setToast((prev) => ({ ...prev, visible: false })), 3500);
  };

  return { toast, showToast };
}
