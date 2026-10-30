import { useCallback, useEffect, useRef, useState } from "react";
import Toast, { useToast } from "../Toast";
import AdminLogin from "./AdminLogin";
import AdminLayout from "./AdminLayout";
import {
  adminFetch,
  clearToken,
  getToken,
  setOnUnauthorized,
  setToken,
} from "./adminApi";
import "../../VolunTag.css";
import "./Admin.css";

export default function AdminApp() {
  // "checking" while an existing token is verified, then "login" or "console".
  const [view, setView] = useState(() => (getToken() ? "checking" : "login"));
  const { toast, showToast } = useToast();

  // Read by the session-ended callback, which is registered once.
  const viewRef = useRef(view);
  const showToastRef = useRef(showToast);

  useEffect(() => {
    viewRef.current = view;
    showToastRef.current = showToast;
  });

  useEffect(() => {
    document.title = "VolunTag Admin";
  }, []);

  useEffect(() => {
    setOnUnauthorized(() => {
      if (viewRef.current === "console") {
        showToastRef.current(
          "Your admin session has ended. Please log in again.",
          "error"
        );
      }
      setView("login");
    });
    return () => setOnUnauthorized(null);
  }, []);

  useEffect(() => {
    if (view !== "checking") return;

    let cancelled = false;

    adminFetch("/admin/me")
      .then(() => {
        if (!cancelled) setView("console");
      })
      .catch(() => {
        // A 401 already cleared the token; any other failure means we cannot
        // confirm the session, so ask for the password again.
        if (!cancelled) setView("login");
      });

    return () => {
      cancelled = true;
    };
  }, [view]);

  const handleLoggedIn = useCallback((token) => {
    setToken(token);
    setView("console");
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await adminFetch("/admin/logout", { method: "POST" });
    } catch {
      // The session is dropped locally either way.
    }
    clearToken();
    setView("login");
    showToastRef.current("You have been logged out.", "success");
  }, []);

  return (
    <div className="adm-root">
      {view === "checking" && (
        <div className="adm-splash" role="status">
          <span className="adm-spinner" aria-hidden="true" />
          Checking your admin session…
        </div>
      )}

      {view === "login" && (
        <AdminLogin onLoggedIn={handleLoggedIn} />
      )}

      {view === "console" && (
        <AdminLayout showToast={showToast} onLogout={handleLogout} />
      )}

      <Toast {...toast} />
    </div>
  );
}
