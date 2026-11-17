import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import "./DashboardLogin.css";
import { API_BASE } from "../config";
import { errorText } from "../api";
import { PATHS } from "../routes";
import { PasswordField, meetsPasswordPolicy } from "./PasswordRules";

const DONE_MESSAGE = "Password updated. Please log in.";

/**
 * Opened from the link in the reset email: /reset-password?token=...
 *
 * The token is read once and removed from the address bar straight away, so
 * it does not stay in the history or leak through a Referer header. The link
 * is checked before the user types anything.
 *
 * States: checking -> form | invalid. A wrong password (422) keeps the form
 * (the link is not used up); an invalid or expired link (400) switches to
 * "invalid"; success goes to the login screen with a toast.
 */
export default function ResetPassword({ showToast }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const [token] = useState(() => searchParams.get("token") || "");
  const [status, setStatus] = useState(token ? "checking" : "invalid");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Remove ?token=... from the address bar without a navigation.
  useEffect(() => {
    if (window.location.search.includes("token=")) {
      window.history.replaceState(window.history.state, "", pathname);
    }
  }, [pathname]);

  useEffect(() => {
    if (!token) return undefined;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/reset-password/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));

        if (cancelled) return;

        if (res.ok) {
          setStatus(data.valid ? "form" : "invalid");
        } else {
          // 429 or a server problem: let the user try the form anyway; the
          // real check happens when the new password is sent.
          setStatus("form");
          setError(errorText(data, "Could not check the link. You can still try to set a new password."));
        }
      } catch {
        if (cancelled) return;
        setStatus("form");
        setError("Could not reach VolunTag to check the link. Check your connection and try again.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (saving) return;

    if (!meetsPasswordPolicy(password)) {
      setError("The new password does not meet all the rules below.");
      return;
    }

    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setError("");
    setSaving(true);

    try {
      const res = await fetch(`${API_BASE}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        showToast((data && data.message) || DONE_MESSAGE, "success");
        // showLogin: show the form even if this tab still thinks it is logged in
        // (every session of the account has just been ended on the server).
        navigate(PATHS["dashboard-login"], { replace: true, state: { showLogin: true } });
        return;
      }

      if (res.status === 400) {
        setStatus("invalid");
        return;
      }

      // 422 (password rules) or 429 (too many attempts): the link still works.
      setError(errorText(data, "Could not update the password. Please try again."));
    } catch {
      setError("Could not reach VolunTag. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page form-page">
      <div className="form-card dashboard-login-card">
        <div className="form-header">
          <h1 className="form-title">
            {status === "invalid" ? "This link has expired" : "Choose a new password"}
          </h1>
          {status !== "invalid" && (
            <p className="form-subtitle">
              Your new password replaces the old one and logs you out everywhere.
            </p>
          )}
        </div>

        {status === "checking" && (
          <p className="auth-message" role="status">
            Checking your reset link...
          </p>
        )}

        {status === "invalid" && (
          <div className="form-step fade-in">
            <div className="auth-message auth-message--error" role="alert">
              <p>This password reset link is invalid or has expired.</p>
              <p>
                Links work once and only for 30 minutes, and asking for a new link cancels the
                older ones. Please request a new link.
              </p>
            </div>

            <div className="auth-links">
              <Link className="auth-link" to={PATHS["forgot-password"]}>
                Request a new link
              </Link>
              <Link className="auth-link" to={PATHS["dashboard-login"]}>
                Back to log in
              </Link>
            </div>
          </div>
        )}

        {status === "form" && (
          <form className="form-step fade-in" onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label htmlFor="reset-password">
                New password <span className="required">*</span>
              </label>
              <PasswordField
                id="reset-password"
                value={password}
                onChange={(value) => {
                  setPassword(value);
                  setError("");
                }}
                hasError={Boolean(error) && !meetsPasswordPolicy(password)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="reset-password-confirm">
                Confirm new password <span className="required">*</span>
              </label>
              <input
                id="reset-password-confirm"
                type="password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  setError("");
                }}
                autoComplete="new-password"
                required
                className={error && confirm && password !== confirm ? "input-error" : ""}
              />
            </div>

            {error && (
              <div className="auth-message auth-message--error" role="alert">
                <p>{error}</p>
              </div>
            )}

            <div className="form-actions">
              <Link className="form-back-btn" to={PATHS["dashboard-login"]}>
                Cancel
              </Link>
              <button
                type="submit"
                className={`submit-btn ${saving ? "loading" : ""}`}
                disabled={saving}
              >
                {saving ? "Saving..." : "Set new password"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
